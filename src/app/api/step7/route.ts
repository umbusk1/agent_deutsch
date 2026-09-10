import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step7PrincipalPrompt, step7PersuasionPrompt, step7EnsamblajePrompt } from "@/lib/prompts";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Relacion, PasajePersuasivo, Alcance } from "@/lib/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  try {
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
    const ensamblajeResult = await callTool<{ reporte: string }>({ ...ensamblajePrompt, effort: "medium" });

    return NextResponse.json({ reporte: ensamblajeResult.reporte });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
