import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step7PrincipalPrompt, step7PersuasionPrompt, step7EnsamblajePrompt } from "@/lib/prompts";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Relacion, PasajePersuasivo, Alcance } from "@/lib/types";

// 120s: el flujo hace 2 llamadas en paralelo (hasta 50s cada una) y luego, ya con ambas
// resueltas, una tercera llamada de ensamblaje (hasta 50s más) — el peor caso ronda los 100s,
// por lo que 90s no dejaba margen y la función podía cortarse a mitad del ensamblaje.
export const maxDuration = 120;

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
  return crearRespuestaSse(request, "step7", async (enviar) => {
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

    // resumenInicial vive acá, no en principalPrompt: depende solo del texto crudo, nunca de los datos
    // estructurados (explicaciones/veredictos/etc.), así que es un trabajo independiente de
    // seccionPrincipal — juntarlos en una sola llamada los hacía competir por el mismo presupuesto de
    // generación y en al menos una corrida real (Redis: análisis "Liberalmente", 2026-09-22) el modelo
    // completó resumenInicial y devolvió seccionPrincipal vacío, sin ningún error.
    const ensamblajePrompt = step7EnsamblajePrompt(
      texto,
      principalResult.seccionPrincipal,
      persuasionResult.seccionPersuasion
    );
    const ensamblajeResult = await callTool<{
      resumenInicial: string;
      introduccion: string;
      transicion: string;
      cierre: string;
    }>({ ...ensamblajePrompt, effort: "medium" });

    // Ninguna de estas partes debería venir vacía salvo "transicion" (opcional por diseño: el propio
    // prompt permite dejarla en blanco si las secciones ya fluyen bien solas). Si alguna otra viene
    // vacía, el filtro de abajo la descarta en silencio del reporte final sin que nadie se entere — se
    // deja registro acá para que una falla así quede visible en los logs, no disfrazada de reporte normal.
    const partesObligatorias: Record<string, string> = {
      resumenInicial: ensamblajeResult.resumenInicial,
      introduccion: ensamblajeResult.introduccion,
      seccionPrincipal: principalResult.seccionPrincipal,
      seccionPersuasion: persuasionResult.seccionPersuasion,
      cierre: ensamblajeResult.cierre,
    };
    for (const [nombre, valor] of Object.entries(partesObligatorias)) {
      if (!valor?.trim()) {
        console.error(`[step7] parte del reporte vino vacía y se descartó en silencio del reporte final: ${nombre}`);
      }
    }

    const reporte = [
      ensamblajeResult.resumenInicial,
      ensamblajeResult.introduccion,
      principalResult.seccionPrincipal,
      ensamblajeResult.transicion?.trim() || null,
      persuasionResult.seccionPersuasion,
      ensamblajeResult.cierre,
    ]
      .filter((parte): parte is string => Boolean(parte?.trim()))
      .join("\n\n");

    enviar({ reporte });
  });
}
