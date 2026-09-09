import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step5Prompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Alcance } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones, problemas, veredictos } = (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
      problemas: Problema[];
      veredictos: Veredicto[];
    };
    if (!texto) {
      return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
    }
    if (!explicaciones?.length) {
      return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
    }
    if (!veredictos?.length) {
      return NextResponse.json(
        { error: "No hay veredictos (ninguna explicación llegó con variantes evaluadas)." },
        { status: 400 }
      );
    }

    const prompt = step5Prompt(texto, explicaciones, problemas, veredictos);
    const result = await callTool<{
      resultados: {
        explicacionId: string;
        problemasNuevos: { enunciado: string; reconocidoPorAutor: "Si" | "No"; justificacion: string }[];
        alcance?: { tipo: "Amplio" | "Limitado"; justificacion: string };
      }[];
    }>(prompt);

    let contador = 0;
    const problemasNuevos: ProblemaNuevo[] = [];
    const alcances: Alcance[] = [];
    for (const r of asArray(result.resultados)) {
      for (const p of asArray(r.problemasNuevos)) {
        if (!p.enunciado?.trim()) continue;
        contador += 1;
        problemasNuevos.push({
          id: `N${contador}`,
          explicacionId: r.explicacionId,
          enunciado: p.enunciado.trim(),
          reconocidoPorAutor: p.reconocidoPorAutor,
          justificacion: p.justificacion,
        });
      }
      if (r.alcance?.tipo && r.alcance.justificacion?.trim()) {
        alcances.push({
          explicacionId: r.explicacionId,
          tipo: r.alcance.tipo,
          justificacion: r.alcance.justificacion.trim(),
        });
      }
    }

    return NextResponse.json({ problemasNuevos, alcances });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
