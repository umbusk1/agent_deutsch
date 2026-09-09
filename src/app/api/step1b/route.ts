import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step1BPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import type { PasajePersuasivo } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
    }

    const prompt = step1BPrompt(texto);
    const result = await callTool<{
      pasajes: { cita: string; mecanismo: "Racional" | "AntiRacional"; tecnicas: string[]; justificacion: string }[];
    }>(prompt);

    const pasajesPersuasivos: PasajePersuasivo[] = asArray(result.pasajes)
      .filter((p) => p.cita?.trim() && p.mecanismo)
      .map((p, i) => ({
        id: `M${i + 1}`,
        cita: p.cita.trim(),
        mecanismo: p.mecanismo,
        tecnicas: asArray(p.tecnicas).filter((t) => t?.trim()),
        justificacion: p.justificacion?.trim() ?? "",
      }));

    return NextResponse.json({ pasajesPersuasivos });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
