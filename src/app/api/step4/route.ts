import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step4Prompt } from "@/lib/prompts";
import type { Explicacion, Problema, VarianteAceptada, Veredicto } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones, problemas, variantesAceptadas } = (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
      problemas: Problema[];
      variantesAceptadas: VarianteAceptada[];
    };
    if (!texto) {
      return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
    }
    if (!explicaciones?.length) {
      return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
    }
    if (!problemas?.length) {
      return NextResponse.json({ error: "No hay problemas activos." }, { status: 400 });
    }
    if (!variantesAceptadas?.length) {
      return NextResponse.json(
        { error: "No quedaron variantes para evaluar (todas fueron descartadas o excluidas)." },
        { status: 400 }
      );
    }

    const porExplicacion = await Promise.all(
      explicaciones.map(async (explicacion) => {
        const problema = problemas.find((p) => p.explicacionId === explicacion.id);
        const variantes = variantesAceptadas.filter((v) => v.explicacionId === explicacion.id);
        if (!problema || variantes.length === 0) return null;

        const prompt = step4Prompt(texto, explicacion, problema, variantes);
        const result = await callTool<{
          resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive"; justificacion: string }[];
          veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
          justificacion: string;
        }>(prompt);

        return {
          explicacionId: explicacion.id,
          resultadosVariantes: result.resultadosVariantes ?? [],
          veredicto: result.veredicto,
          justificacion: result.justificacion,
        };
      })
    );

    const veredictos: Veredicto[] = porExplicacion.filter((v): v is Veredicto => v !== null);

    return NextResponse.json({ veredictos });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
