import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesionPasaje, guardarMejoraSesionPasaje, MAX_INTENTOS_PASAJE } from "@/lib/mejora";
import { desbloquearTextoMejora, MEJORA_TEXTOS_LIMIT_SEMANAL } from "@/lib/usage";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { asArray } from "@/lib/safe-array";
import { mejoraDespojoPasajePrompt, mejoraNotaPasajePrompt } from "@/lib/prompts";
import type { IntentoMejoraPasaje, MejoraSesionPasaje } from "@/lib/types";

/** El mecanismo NUNCA lo decide el modelo directamente (ver mejoraDespojoPasajePrompt) — se calcula acá, a
 * partir del desglose oración por oración que sí tuvo que hacer. Todas sobreviven -> Racional; ninguna
 * sobrevive -> AntiRacional; mezcla -> Mixto. Confirmado con un caso real: pidiéndole un "mecanismo" directo
 * para el fragmento completo, el modelo lo declaraba "Racional" de forma holística aunque una sola oración
 * (identificada correctamente en una llamada aparte, la de la nota de mentor) no sobreviviera el despojo por
 * sí sola — forzar el desglose y calcular el agregado acá, en vez de confiar en que el modelo lo agregue bien
 * por su cuenta, es lo que cierra esa brecha.
 */
function calcularMecanismo(
  analisisPorOracion: { oracion: string; sobreviveDespojo: boolean; razon: string }[]
): "Racional" | "AntiRacional" | "Mixto" {
  if (analisisPorOracion.length === 0) return "AntiRacional"; // no debería pasar; conservador si pasa
  const todasSobreviven = analisisPorOracion.every((o) => o.sobreviveDespojo);
  if (todasSobreviven) return "Racional";
  const ningunaSobrevive = analisisPorOracion.every((o) => !o.sobreviveDespojo);
  if (ningunaSobrevive) return "AntiRacional";
  return "Mixto";
}

function sinEspacios(s: string): string {
  return s.replace(/\s+/g, "");
}

/** El modelo podría, en teoría, devolver un desglose que "suene" completo sin cubrir realmente todo el
 * fragmento (una oración de más, una de menos, una parafraseada en vez de citada) — eso invalidaría
 * calcularMecanismo en silencio, porque el agregado se calcula sobre oraciones que ya no representan el
 * fragmento real. Se verifica concatenando (ignorando espacios, nunca puntuación exacta de por medio porque el
 * modelo puede normalizar comillas/guiones al citar) contra el texto editado — si no reconstruye, es un error
 * explícito, nunca una clasificación silenciosa sobre datos que no se pudieron verificar. */
function oracionesReconstruyenTexto(
  analisisPorOracion: { oracion: string }[],
  textoEditado: string
): boolean {
  const reconstruido = analisisPorOracion.map((o) => o.oracion).join("");
  return sinEspacios(reconstruido) === sinEspacios(textoEditado);
}

// 90s: dos llamadas SECUENCIALES por intento (despojo → nota de mentor) — menos que Explicación, que además
// del despojo tiene el mecanismo de sustitución completo. Streaming SSE con heartbeat por la misma razón de
// siempre: sin esto, el navegador puede pasar tiempo sin recibir ningún byte durante las dos llamadas.
export const maxDuration = 90;

function comoResultadoParaNota(intento: {
  texto: string;
  mecanismo: "Racional" | "AntiRacional" | "Mixto";
  analisisPorOracion: { oracion: string; sobreviveDespojo: boolean; razon: string }[];
  tecnicas: string[];
  justificacion: string;
}) {
  return intento;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; pasajeId: string }> }
) {
  const { id: analisisId, pasajeId } = await params;

  const rawUsername = request.headers.get("x-au-user");
  const username = rawUsername ? decodeURIComponent(rawUsername) : null;
  const user = username ? findUser(username) : undefined;
  if (!user) {
    return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
  }

  const { texto: textoEditado } = (await request.json()) as { texto: string };
  if (!textoEditado || !textoEditado.trim()) {
    return NextResponse.json({ error: "Falta el fragmento editado." }, { status: 400 });
  }

  const analisis = await obtenerAnalisis(analisisId);
  if (!analisis || !analisis.texto || !analisis.pasajesPersuasivos) {
    return NextResponse.json(
      { error: "Este análisis no tiene los datos completos que Mejora necesita." },
      { status: 400 }
    );
  }

  const pasajeOriginal = analisis.pasajesPersuasivos.find((p) => p.id === pasajeId);
  if (!pasajeOriginal) {
    return NextResponse.json({ error: "Pasaje no encontrado en este análisis." }, { status: 404 });
  }
  if (pasajeOriginal.mecanismo !== "AntiRacional") {
    return NextResponse.json(
      { error: "Mejora solo cubre pasajes que cierran el argumento por ahora." },
      { status: 400 }
    );
  }

  const sesionExistente = await obtenerMejoraSesionPasaje(analisisId, pasajeId);
  if (sesionExistente && sesionExistente.intentos.length >= MAX_INTENTOS_PASAJE) {
    return NextResponse.json(
      { error: `Ya alcanzaste el máximo de ${MAX_INTENTOS_PASAJE} intentos para este pasaje.` },
      { status: 400 }
    );
  }

  // Mismo cupo semanal que Explicación, mismo bypass de admin — es el mismo "texto", solo cambia qué
  // hallazgo puntual se está evaluando dentro de él (ver desbloquearTextoMejora en usage.ts).
  const isAdmin = user.role === "admin";
  const desbloqueado = isAdmin || (await desbloquearTextoMejora(user.username, analisisId));
  if (!desbloqueado) {
    return NextResponse.json(
      {
        error: `Alcanzaste tu cupo de ${MEJORA_TEXTOS_LIMIT_SEMANAL} textos por semana para Mejora. El cupo se reinicia el próximo lunes.`,
      },
      { status: 429 }
    );
  }

  const texto = analisis.texto;

  return crearRespuestaSse(request, "mejora-pasaje-evaluar", async (enviar) => {
    const numeroIntento = (sesionExistente?.intentos.length ?? 0) + 1;
    const intentoAnteriorRegistro = sesionExistente?.intentos[sesionExistente.intentos.length - 1] ?? null;
    // La versión inmediatamente anterior de ESTE fragmento puntual — el intento previo si ya hubo alguno, o
    // la cita original sin editar si este es el primer intento. Nunca null en la práctica: siempre hay algo
    // contra qué contrastar, incluso en el primer intento.
    const versionAnterior = intentoAnteriorRegistro?.texto ?? pasajeOriginal.cita;

    const despojoPrompt = mejoraDespojoPasajePrompt(texto, textoEditado, pasajeOriginal.tecnicas, versionAnterior);
    // strict:true (con additionalProperties:false en cada nivel del schema, ver mejoraDespojoPasajePrompt) para
    // que "required" se aplique de verdad — analisisPorOracion es exactamente el campo que necesita forzarse,
    // no vale la pena repetir acá el hueco ya documentado en anthropic.ts de confiar en required sin strict.
    const resultDespojo = await callTool<{
      analisisPorOracion: { oracion: string; sobreviveDespojo: boolean; razon: string }[];
      tecnicas: string[];
      justificacion: string;
    }>({ ...despojoPrompt, strict: true });

    const analisisPorOracion = asArray(resultDespojo.analisisPorOracion);

    // Error explícito, no clasificación: si el desglose no reconstruye el fragmento editado, el agregado de
    // calcularMecanismo estaría calculado sobre oraciones que no representan con fidelidad lo que el usuario
    // realmente escribió — no hay clasificación confiable posible a partir de acá. Nada se guarda (ni el
    // intento, ni el cupo semanal ya se gastó antes de esta llamada — ver el comentario sobre eso más abajo).
    if (!oracionesReconstruyenTexto(analisisPorOracion, textoEditado)) {
      enviar({
        error:
          "El desglose oración por oración que devolvió el modelo no reconstruye el fragmento editado — no se puede confiar en la clasificación resultante. Probá de nuevo.",
      });
      return;
    }

    const mecanismo = calcularMecanismo(analisisPorOracion);

    const intentoActualParaNota = comoResultadoParaNota({
      texto: textoEditado,
      mecanismo,
      analisisPorOracion,
      tecnicas: resultDespojo.tecnicas,
      justificacion: resultDespojo.justificacion,
    });
    const intentoAnteriorParaNota = intentoAnteriorRegistro
      ? comoResultadoParaNota(intentoAnteriorRegistro)
      : null;

    const notaPrompt = mejoraNotaPasajePrompt(
      pasajeOriginal.tecnicas,
      pasajeOriginal.justificacion,
      intentoActualParaNota,
      intentoAnteriorParaNota,
      numeroIntento
    );
    const resultNota = await callTool<{ notaMentor: string }>(notaPrompt);

    const nuevoIntento: IntentoMejoraPasaje = {
      id: `I${numeroIntento}`,
      texto: textoEditado,
      creadoEn: new Date().toISOString(),
      mecanismo,
      analisisPorOracion,
      tecnicas: resultDespojo.tecnicas,
      justificacion: resultDespojo.justificacion,
      notaMentor: resultNota.notaMentor,
    };

    const ahora = new Date().toISOString();
    const sesion: MejoraSesionPasaje = sesionExistente
      ? { ...sesionExistente, intentos: [...sesionExistente.intentos, nuevoIntento], actualizadoEn: ahora }
      : {
          tipo: "pasaje",
          id: `${analisisId}:pasaje:${pasajeId}`,
          analisisId,
          pasajeId,
          tecnicasOriginales: pasajeOriginal.tecnicas,
          razonDespojo: pasajeOriginal.justificacion,
          intentos: [nuevoIntento],
          aplicadoIntentoId: null,
          usuario: user.username,
          creadoEn: ahora,
          actualizadoEn: ahora,
        };

    await guardarMejoraSesionPasaje(sesion);

    enviar({ sesion });
  });
}
