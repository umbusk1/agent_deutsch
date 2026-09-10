import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step7PrincipalPrompt, step7PersuasionPrompt, step7EnsamblajePrompt } from "@/lib/prompts";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Relacion, PasajePersuasivo, Alcance } from "@/lib/types";

export const maxDuration = 90;

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const { texto, explicaciones, problemas, veredictos, problemasNuevos, relaciones, pasajesPersuasivos, alcances } =
    (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
      problemas: Problema[];
      veredictos: Veredicto[];
      problemasNuevos: ProblemaNuevo[];
      relaciones: Relacion[];
      pasajesPersuasivos: PasajePersuasivo[];
      alcances: Alcance[];
    };

  if (!texto) {
    return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
  }
  if (!explicaciones?.length) {
    return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
  }

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final: si el navegador no recibe
  // ningún byte mientras esperamos a Claude, algún intermediario entre el cliente y Vercel corta la
  // conexión por inactividad aunque la función termine bien (ERR_CONNECTION_CLOSED con 200 en los logs).
  // El heartbeat cada 10s mantiene la conexión viva durante las llamadas largas.
  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 10_000);

      try {
        const problemasNuevosPorExplicacion = new Map<
          string,
          { enunciado: string; reconocidoPorAutor: string }[]
        >();
        for (const pn of problemasNuevos ?? []) {
          const lista = problemasNuevosPorExplicacion.get(pn.explicacionId) ?? [];
          lista.push({ enunciado: pn.enunciado, reconocidoPorAutor: pn.reconocidoPorAutor });
          problemasNuevosPorExplicacion.set(pn.explicacionId, lista);
        }

        const pasajesAntiRacionales = (pasajesPersuasivos ?? []).filter((p) => p.mecanismo === "AntiRacional");

        const principalPrompt = step7PrincipalPrompt(
          texto,
          explicaciones,
          problemas,
          veredictos,
          problemasNuevosPorExplicacion,
          relaciones ?? [],
          alcances ?? []
        );
        const persuasionPrompt = step7PersuasionPrompt(pasajesAntiRacionales);

        const [principalResult, persuasionResult] = await Promise.all([
          callTool<{ seccionPrincipal: string }>({ ...principalPrompt, effort: "medium" }),
          callTool<{ seccionPersuasion: string }>({ ...persuasionPrompt, effort: "medium" }),
        ]);

        const ensamblajePrompt = step7EnsamblajePrompt(
          principalResult.seccionPrincipal,
          persuasionResult.seccionPersuasion
        );
        const ensamblajeResult = await callTool<{ introduccion: string; transicion: string; cierre: string }>({
          ...ensamblajePrompt,
          effort: "medium",
        });

        const reporte = [
          ensamblajeResult.introduccion,
          principalResult.seccionPrincipal,
          ensamblajeResult.transicion?.trim() || null,
          persuasionResult.seccionPersuasion,
          ensamblajeResult.cierre,
        ]
          .filter((parte): parte is string => Boolean(parte?.trim()))
          .join("\n\n");

        clearInterval(heartbeat);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ reporte })}\n\n`));
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
