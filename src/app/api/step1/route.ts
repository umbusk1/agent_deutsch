import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step1Prompt } from "@/lib/prompts";
import type { Explicacion, Descartada } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
    }

    const prompt = step1Prompt(texto);
    const result = await callTool<{
      candidatas: { cita: string; resumen: string }[];
      descartadas: Descartada[];
    }>(prompt);

    const explicaciones: Explicacion[] = result.candidatas.map((c, i) => ({
      id: `E${i + 1}`,
      cita: c.cita,
      resumen: c.resumen,
    }));

    return NextResponse.json({ explicaciones, descartadas: result.descartadas });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
