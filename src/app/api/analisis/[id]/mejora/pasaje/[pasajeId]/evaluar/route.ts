import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesionPasaje, guardarMejoraSesionPasaje, MAX_INTENTOS_PASAJE } from "@/lib/mejora";
import { desbloquearTextoMejora, MEJORA_TEXTOS_LIMIT_SEMANAL } from "@/lib/usage";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { mejoraDespojoPasajePrompt, mejoraNotaPasajePrompt } from "@/lib/prompts";
import type { IntentoMejoraPasaje, MejoraSesionPasaje } from "@/lib/types";

// 90s: dos llamadas SECUENCIALES por intento (despojo → nota de mentor) — menos que Explicación, que además
// del despojo tiene el mecanismo de sustitución completo. Streaming SSE con heartbeat por la misma razón de
// siempre: sin esto, el navegador puede pasar tiempo sin recibir ningún byte durante las dos llamadas.
export const maxDuration = 90;

function comoResultadoParaNota(intento: {
  texto: string;
  mecanismo: "Racional" | "AntiRacional" | "Mixto";
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
    const resultDespojo = await callTool<{
      mecanismo: "Racional" | "AntiRacional" | "Mixto";
      tecnicas: string[];
      justificacion: string;
    }>(despojoPrompt);

    const intentoActualParaNota = comoResultadoParaNota({
      texto: textoEditado,
      mecanismo: resultDespojo.mecanismo,
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
      mecanismo: resultDespojo.mecanismo,
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
