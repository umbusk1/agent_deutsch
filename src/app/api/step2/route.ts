import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { explicacionPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import type { Explicacion, Descartada, Problema } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { texto, problemas } = (await request.json()) as { texto: string; problemas: Problema[] };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
    }
    if (!problemas?.length) {
      return NextResponse.json(
        { error: "No hay problemas activos (¿se excluyeron todos en el paso anterior?)." },
        { status: 400 }
      );
    }

    const prompt = explicacionPrompt(texto, problemas);
    const result = await callTool<{
      candidatas: {
        problemaId: string;
        cita: string;
        resumen: string;
        mecanismoGeneral: string;
        puente: { laguna: boolean; justificacion: string };
        imagenCentral?: { presente: boolean; imagen: string | null; connotacionAñadida: string | null };
        premisaValorOculta?: { presente: boolean; justificacion: string | null };
      }[];
      descartadas: Descartada[];
    }>({ ...prompt, effort: "medium" });

    const explicaciones: Explicacion[] = asArray(result.candidatas)
      .filter(
        (c) =>
          c.cita?.trim() &&
          c.resumen?.trim() &&
          c.mecanismoGeneral?.trim() &&
          problemas.some((p) => p.id === c.problemaId)
      )
      .map((c, i) => ({
        id: `E${i + 1}`,
        problemaId: c.problemaId,
        cita: c.cita.trim(),
        resumen: c.resumen.trim(),
        mecanismoGeneral: c.mecanismoGeneral.trim(),
        puente: {
          laguna: Boolean(c.puente?.laguna),
          justificacion: c.puente?.justificacion?.trim() ?? "",
        },
        // Sin strict:true, "required" no se aplica de verdad — si el modelo omite el campo, asumimos
        // "no presente" en vez de dejarlo sin marcar.
        imagenCentral: {
          presente: Boolean(c.imagenCentral?.presente),
          imagen: c.imagenCentral?.presente ? (c.imagenCentral?.imagen?.trim() ?? null) : null,
          connotacionAñadida: c.imagenCentral?.presente ? (c.imagenCentral?.connotacionAñadida?.trim() ?? null) : null,
        },
        premisaValorOculta: {
          presente: Boolean(c.premisaValorOculta?.presente),
          justificacion: c.premisaValorOculta?.presente ? (c.premisaValorOculta?.justificacion?.trim() ?? null) : null,
        },
      }));

    const descartadas = asArray(result.descartadas).filter((d) => d.cita?.trim() && d.motivo?.trim());

    return NextResponse.json({ explicaciones, descartadas });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
