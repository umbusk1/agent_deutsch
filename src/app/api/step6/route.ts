import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step6Prompt } from "@/lib/prompts";
import type { Explicacion, Problema, Relacion } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { explicaciones, problemas } = (await request.json()) as {
      explicaciones: Explicacion[];
      problemas: Problema[];
    };
    if (!explicaciones || explicaciones.length < 2) {
      return NextResponse.json({ relaciones: [] as Relacion[] });
    }

    const prompt = step6Prompt(explicaciones, problemas);
    const result = await callTool<{ relaciones: Relacion[] }>(prompt);

    const relaciones = (result.relaciones ?? []).filter(
      (r) => r.explicacionAId?.trim() && r.explicacionBId?.trim() && r.explicacionAId !== r.explicacionBId
    );

    return NextResponse.json({ relaciones });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
