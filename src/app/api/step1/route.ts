import { NextResponse } from "next/server";
import { callFreeform, callTool } from "@/lib/anthropic";
import { problemaRazonamientoPrompt, problemaEstructuraPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { findUser } from "@/lib/users";
import { peekUsage, incrementUsage } from "@/lib/usage";
import type { Problema } from "@/lib/types";

export const maxDuration = 90;

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const { texto } = (await request.json()) as { texto: string };
  if (!texto || !texto.trim()) {
    return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
  }

  const rawUsername = request.headers.get("x-au-user");
  const username = rawUsername ? decodeURIComponent(rawUsername) : null;
  const user = username ? findUser(username) : undefined;
  const limited = Boolean(user && !user.unlimited && user.limit);

  if (user && limited) {
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
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 10_000);

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
        if (user && limited) {
          try {
            await incrementUsage(user.username);
          } catch (usageError) {
            console.error("Fallo al registrar el consumo de cuota:", usageError);
          }
        }

        clearInterval(heartbeat);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ problemas, _debugRazonamiento: razonamiento })}\n\n`));
        controller.close();
      } catch (error) {
        clearInterval(heartbeat);
        console.error(error);
        const message = error instanceof Error ? error.message : "Error desconocido.";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
