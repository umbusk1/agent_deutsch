import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step2Prompt } from "@/lib/prompts";
import type { Explicacion, Problema } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones } = (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
    };
    if (!texto) {
      return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
    }
    if (!explicaciones?.length) {
      return NextResponse.json(
        { error: "No hay explicaciones activas (¿se excluyeron todas en el paso anterior?)." },
        { status: 400 }
      );
    }

    const prompt = step2Prompt(texto, explicaciones);
    const result = await callTool<{
      problemas: { explicacionId: string; enunciado: string }[];
    }>(prompt);

    const problemas: Problema[] = (result.problemas ?? [])
      .filter((p) => p.explicacionId?.trim() && p.enunciado?.trim())
      .map((p, i) => ({
        id: `P${i + 1}`,
        explicacionId: p.explicacionId,
        enunciado: p.enunciado,
      }));

    return NextResponse.json({ problemas });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
