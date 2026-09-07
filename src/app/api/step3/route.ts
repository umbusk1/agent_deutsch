import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step3Prompt } from "@/lib/prompts";
import type { Explicacion, Problema, VarianteAceptada, VarianteDescartada } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones, problemas } = (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
      problemas: Problema[];
    };
    if (!texto || !explicaciones?.length || !problemas?.length) {
      return NextResponse.json({ error: "Faltan datos para este paso." }, { status: 400 });
    }

    const variantesAceptadas: VarianteAceptada[] = [];
    const variantesDescartadas: VarianteDescartada[] = [];
    let contador = 0;

    for (const explicacion of explicaciones) {
      const problema = problemas.find((p) => p.explicacionId === explicacion.id);
      if (!problema) continue;

      const prompt = step3Prompt(texto, explicacion, problema);
      const result = await callTool<{
        variantesAceptadas: { descripcion: string }[];
        variantesDescartadas: { descripcion: string; motivo: string }[];
      }>(prompt);

      for (const v of result.variantesAceptadas) {
        contador += 1;
        variantesAceptadas.push({
          id: `V${contador}`,
          explicacionId: explicacion.id,
          descripcion: v.descripcion,
        });
      }
      for (const v of result.variantesDescartadas) {
        variantesDescartadas.push({
          explicacionId: explicacion.id,
          descripcion: v.descripcion,
          motivo: v.motivo,
        });
      }
    }

    return NextResponse.json({ variantesAceptadas, variantesDescartadas });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
