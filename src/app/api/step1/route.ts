import { NextResponse } from "next/server";
import { callFreeform, callTool } from "@/lib/anthropic";
import { problemaRazonamientoPrompt, problemaEstructuraPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { findUser } from "@/lib/users";
import {
  peekUsage,
  incrementUsage,
  desbloquearTextoMejora,
  revertirDesbloqueoTexto,
  MEJORA_TEXTOS_LIMIT_SEMANAL,
} from "@/lib/usage";
import { resolverVersionNueva } from "@/lib/versiones";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Problema } from "@/lib/types";

// 150s (subido de 90, 2026-09-30): el peor caso estructural ya era mayor que 90s antes de este cambio —
// callFreeform (razonamiento, sin reintento) 40s + callTool (estructura, con hasta un reintento por marcador
// mal formado) 2×40s = 120s. 150s cubre ese peor caso con margen, sin tocar los timeoutMs individuales (no
// hay dato real todavía que indique que 40s sea insuficiente para ninguna de las dos llamadas).
export const maxDuration = 150;

export async function POST(request: Request) {
  const { texto, versionDeId } = (await request.json()) as { texto: string; versionDeId?: string };
  if (!texto || !texto.trim()) {
    return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
  }

  const rawUsername = request.headers.get("x-au-user");
  const username = rawUsername ? decodeURIComponent(rawUsername) : null;
  const user = username ? findUser(username) : undefined;
  const limited = Boolean(user && !user.unlimited && user.limit);

  // Versión nueva de un análisis existente ("Editar y volver a analizar"): NO gasta el cupo de análisis. Cuenta
  // contra el cupo de Mejora, por TEXTO (se desbloquea la raíz de las versiones, así que reabrir el mismo texto
  // otra vez la misma semana no vuelve a cobrar); los admin no tocan ningún cupo. Antes de cualquier llamada a
  // Claude: autor, tope de versiones, que el texto de verdad haya cambiado, y cupo.
  let esVersion = false;
  let desbloqueoNuevo: { username: string; raizId: string } | null = null;
  if (versionDeId) {
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }
    const esAdmin = user.role === "admin";
    const resolucion = await resolverVersionNueva(versionDeId, user.username, esAdmin);
    if (!resolucion.ok) {
      return NextResponse.json({ error: resolucion.error }, { status: resolucion.status });
    }
    if ((resolucion.anterior.texto ?? "").trim() === texto.trim()) {
      return NextResponse.json(
        { error: "El texto es idéntico al de la versión anterior: no hay nada nuevo que analizar." },
        { status: 400 }
      );
    }
    if (!esAdmin) {
      const { desbloqueado, fueNuevo } = await desbloquearTextoMejora(user.username, resolucion.raizId);
      if (!desbloqueado) {
        return NextResponse.json(
          {
            error: `Alcanzaste tu cupo de ${MEJORA_TEXTOS_LIMIT_SEMANAL} textos por semana para Mejora. El cupo se reinicia el próximo lunes.`,
          },
          { status: 429 }
        );
      }
      if (fueNuevo) desbloqueoNuevo = { username: user.username, raizId: resolucion.raizId };
    }
    esVersion = true;
  }

  if (user && limited && !esVersion) {
    try {
      const used = await peekUsage(user.username);
      if (used >= user.limit!) {
        return NextResponse.json(
          {
            error: `Alcanzaste tu límite de ${user.limit} análisis esta semana. El cupo se reinicia el próximo lunes.`,
          },
          { status: 429 }
        );
      }
    } catch (usageError) {
      console.error("Fallo al consultar la cuota de uso, se permite el análisis sin contar:", usageError);
    }
  }

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final: con dos llamadas seguidas a Claude
  // (razonamiento libre + estructurar), el navegador puede pasar 30-45s sin recibir ningún byte, y algún
  // intermediario entre el cliente y Vercel corta la conexión por inactividad aunque la función termine bien
  // (ERR_CONNECTION_CLOSED con 200 en los logs de Vercel — mismo problema ya resuelto en el Paso 7).
  return crearRespuestaSse(request, "step1", async (enviar) => {
    try {
      // Dos llamadas: primero razonamiento libre (sin tool_choice forzado, para que el modelo piense de
      // verdad en vez de tomar el atajo de relleno bajo presión de schema), luego una llamada corta que solo
      // estructura lo que el razonamiento ya aceptó.
      const razonamientoPrompt = problemaRazonamientoPrompt(texto);
      const razonamiento = await callFreeform({
        ...razonamientoPrompt,
        effort: "medium",
        timeoutMs: 40_000,
      });

      const estructuraPrompt = problemaEstructuraPrompt(razonamiento);
      const result = await callTool<{
        problemas: { tipo: "maestro" | "local"; enunciado: string }[];
      }>({ ...estructuraPrompt, effort: "medium", strict: true, timeoutMs: 40_000 });

      // A lo sumo un problema maestro: si el modelo devolvió más de uno, el primero se queda como
      // maestro y el resto baja a local, para no romper el chequeo de puente del paso siguiente
      // (que asume un único maestro de referencia).
      let maestroAsignado = false;
      const problemas: Problema[] = asArray(result.problemas)
        .filter((p) => p.enunciado?.trim() && (p.tipo === "maestro" || p.tipo === "local"))
        .map((p, i) => {
          const esMaestro = p.tipo === "maestro" && !maestroAsignado;
          if (esMaestro) maestroAsignado = true;
          return {
            id: `PR${i + 1}`,
            tipo: esMaestro ? "maestro" : "local",
            enunciado: p.enunciado.trim(),
          };
        });

      // La llamada ya se hizo (costo real) independientemente de si se encontró algún problema, así
      // que el cupo se consume igual — el paso 2 (o el rechazo) decide qué pasa después con esto.
      if (user && limited && !esVersion) {
        try {
          await incrementUsage(user.username);
        } catch (usageError) {
          console.error("Fallo al registrar el consumo de cuota:", usageError);
        }
      }

      enviar({ problemas, razonamiento });
    } catch (error) {
      // Si esta llamada fue la que desbloqueó el texto para Mejora y falló antes de dar ningún resultado, se
      // devuelve el cupo (mismo criterio que la ruta de evaluar de Mejora).
      if (desbloqueoNuevo) {
        try {
          await revertirDesbloqueoTexto(desbloqueoNuevo.username, desbloqueoNuevo.raizId);
        } catch (revertError) {
          console.error("Fallo al revertir el desbloqueo de Mejora:", revertError);
        }
      }
      throw error;
    }
  });
}
