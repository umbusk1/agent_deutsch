import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesionPasaje, guardarMejoraSesionPasaje } from "@/lib/mejora";
import { MAX_INTENTOS_PASAJE } from "@/lib/mejora-limites";
import { desbloquearTextoMejora, revertirDesbloqueoTexto, MEJORA_TEXTOS_LIMIT_SEMANAL } from "@/lib/usage";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { asArray } from "@/lib/safe-array";
import { mejoraDespojoPasajePrompt, mejoraNotaPasajePrompt } from "@/lib/prompts";
import { generarNotaMentorVerificada } from "@/lib/nota-mentor-validacion";
import { calcularMecanismo, oracionesReconstruyenTexto } from "@/lib/despojo";
import type { IntentoMejoraPasaje, MejoraSesionPasaje } from "@/lib/types";

// 300s (subido de 230, 2026-10-01 — ahora cuenta también el reintento propio de la nota de mentor, ver
// generarNotaMentorVerificada en nota-mentor-validacion.ts). Hasta 3 llamadas SECUENCIALES por intento en el
// peor caso (despojo → nota de mentor → reintento de la nota si no pasa la verificación de voseo/caracteres
// anómalos) — el chequeo de reconstrucción del despojo no reintenta, lanza error directo (ver
// oracionesReconstruyenTexto más abajo), así que el reintento en juego de cada llamada individual sigue
// siendo solo el de callTool por marcador mal formado: peor caso real = 3×(2×50s) = 300s, con el timeoutMs
// default de callTool, sin tocar.
// BRECHA CONOCIDA: 300s de peor caso teórico iguala, sin margen, los 300s documentados en el plan Hobby con
// Fluid Compute — mismo techo que mejora/[explicacionId]/evaluar. En el escenario extremo (las tres llamadas
// fallando con marcador mal formado en su primer intento Y la nota fallando la verificación, nunca visto en
// producción) la función se cortaría antes de terminar. No se tocó la lógica de reintentos para cerrar esta
// brecha — decisión explícita, pendiente de revisar si alguna vez se observa en la práctica.
export const maxDuration = 300;

// Separa lo que escribió el usuario (textoDelUsuario) de lo que calculó el sistema al reclasificar ese
// fragmento (generadoPorElSistema) — ver el comentario junto a ResultadoParaNotaPasaje en prompts.ts.
function comoResultadoParaNota(intento: {
  texto: string;
  mecanismo: "Racional" | "AntiRacional" | "Mixto";
  analisisPorOracion: { oracion: string; sobreviveDespojo: boolean; razon: string }[];
  tecnicas: string[];
  justificacion: string;
}) {
  return {
    textoDelUsuario: intento.texto,
    generadoPorElSistema: {
      mecanismo: intento.mecanismo,
      analisisPorOracion: intento.analisisPorOracion,
      tecnicas: intento.tecnicas,
      justificacion: intento.justificacion,
    },
  };
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
  // Mejora está restringida al autor del análisis, SIN excepción para admin — antes de gastar cupo o llamar
  // a Claude, no después. Ver el mismo chequeo en mejora/route.ts (lista) y en las demás rutas de Mejora.
  if (analisis.usuario !== user.username) {
    return NextResponse.json(
      { error: "Mejora está restringido al autor de este análisis." },
      { status: 403 }
    );
  }

  const pasajeOriginal = analisis.pasajesPersuasivos.find((p) => p.id === pasajeId);
  if (!pasajeOriginal) {
    return NextResponse.json({ error: "Pasaje no encontrado en este análisis." }, { status: 404 });
  }
  if (pasajeOriginal.mecanismo !== "AntiRacional" && pasajeOriginal.mecanismo !== "Mixto") {
    return NextResponse.json(
      { error: "Mejora solo cubre pasajes que cierran el argumento, del todo o en parte, por ahora." },
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
  // fueNuevo distingue "este texto se acaba de desbloquear con ESTA llamada" (el `return { desbloqueado:
  // true, fueNuevo: true }` tras el SADD, en desbloquearTextoMejora/usage.ts) de "ya estaba desbloqueado de
  // antes" (el `return { desbloqueado: true, fueNuevo: false }` temprano por yaEstaba, misma función). Los
  // admin nunca tocan el SET, así que para ellos fueNuevo es siempre false: si la llamada de un admin falla,
  // no hay nada que revertir.
  const { desbloqueado, fueNuevo } = isAdmin
    ? { desbloqueado: true, fueNuevo: false }
    : await desbloquearTextoMejora(user.username, analisisId);
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
    try {
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
      // realmente escribió — no hay clasificación confiable posible a partir de acá. Se tira como excepción
      // (en vez de enviar+return) para pasar por el mismo catch de abajo, que decide si corresponde revertir
      // el desbloqueo del cupo — un solo lugar que decide eso, no dos caminos de falla distintos.
      if (!oracionesReconstruyenTexto(analisisPorOracion, textoEditado)) {
        throw new Error(
          "El desglose oración por oración que devolvió el modelo no reconstruye el fragmento editado — no se puede confiar en la clasificación resultante. Probá de nuevo."
        );
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
      const notaMentor = await generarNotaMentorVerificada(notaPrompt, "mejora-pasaje-evaluar");

      const nuevoIntento: IntentoMejoraPasaje = {
        id: `I${numeroIntento}`,
        texto: textoEditado,
        creadoEn: new Date().toISOString(),
        mecanismo,
        analisisPorOracion,
        tecnicas: resultDespojo.tecnicas,
        justificacion: resultDespojo.justificacion,
        notaMentor,
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
    } catch (error) {
      // Si esta misma llamada fue la que desbloqueó el texto (fueNuevo) y no llegó a guardar ningún intento
      // (guardarMejoraSesionPasaje no se alcanzó a ejecutar más arriba), revierte el desbloqueo — el usuario
      // no debería perder uno de sus 2 textos semanales por una llamada que no produjo nada. Un texto que ya
      // estaba desbloqueado antes de esta llamada nunca se toca acá.
      if (fueNuevo) {
        await revertirDesbloqueoTexto(user.username, analisisId);
      }
      throw error; // re-lanzado para que crearRespuestaSse siga logueando y avisando al cliente como siempre
    }
  });
}
