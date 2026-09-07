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
    if (!texto || !explicaciones?.length || !problemas?.length) {
      return NextResponse.json({ error: "Faltan datos para este paso." }, { status: 400 });
    }

    const veredictos: Veredicto[] = [];

    for (const explicacion of explicaciones) {
      const problema = problemas.find((p) => p.explicacionId === explicacion.id);
      const variantes = variantesAceptadas.filter((v) => v.explicacionId === explicacion.id);
      if (!problema || variantes.length === 0) continue;

      const prompt = step4Prompt(texto, explicacion, problema, variantes);
      const result = await callTool<{
        resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive"; justificacion: string }[];
        veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
        justificacion: string;
      }>(prompt);

      veredictos.push({
        explicacionId: explicacion.id,
        resultadosVariantes: result.resultadosVariantes,
        veredicto: result.veredicto,
        justificacion: result.justificacion,
      });
    }

    return NextResponse.json({ veredictos });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
