import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step7Prompt } from "@/lib/prompts";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Relacion, PasajePersuasivo } from "@/lib/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones, problemas, veredictos, problemasNuevos, relaciones, pasajesPersuasivos } =
      (await request.json()) as {
        texto: string;
        explicaciones: Explicacion[];
        problemas: Problema[];
        veredictos: Veredicto[];
        problemasNuevos: ProblemaNuevo[];
        relaciones: Relacion[];
        pasajesPersuasivos: PasajePersuasivo[];
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

    const prompt = step7Prompt(
      texto,
      explicaciones,
      problemas,
      veredictos,
      problemasNuevosPorExplicacion,
      relaciones ?? [],
      pasajesAntiRacionales
    );
    const result = await callTool<{ reporte: string }>(prompt);

    return NextResponse.json({ reporte: result.reporte });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
