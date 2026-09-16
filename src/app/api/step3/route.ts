import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step3IdentificarPrompt, step3VariantesPrompt, type IdentificacionVariante } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import type { Explicacion, Problema, VarianteAceptada, VarianteDescartada } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones, problemas } = (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
      problemas: Problema[];
    };
    if (!texto) {
      return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
    }
    if (!explicaciones?.length) {
      return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
    }
    if (!problemas?.length) {
      return NextResponse.json(
        { error: "No hay problemas activos (¿se podaron todos en el paso anterior?)." },
        { status: 400 }
      );
    }

    const porExplicacion = await Promise.all(
      explicaciones.map(async (explicacion) => {
        const problema = problemas.find((p) => p.id === explicacion.problemaId);
        if (!problema) return null;

        // Dos llamadas: primero identificar qué es fijo y cuál es el ingrediente variable (sin generar
        // todavía ningún sustituto), luego generar sustitutos solo para ese ingrediente ya nombrado. Mezclar
        // ambas cosas en una sola llamada producía sistemáticamente reescrituras estructurales en vez de
        // sustituciones mínimas — ver el comentario junto a step3IdentificarPrompt.
        const identificacionPrompt = step3IdentificarPrompt(texto, explicacion, problema);
        const identificacion = await callTool<IdentificacionVariante>(identificacionPrompt);

        const variantesPrompt = step3VariantesPrompt(texto, explicacion, problema, identificacion);
        const result = await callTool<{
          variantesAceptadas: { descripcion: string }[];
          variantesDescartadas: { descripcion: string; motivo: string }[];
        }>(variantesPrompt);

        return { explicacion, result, identificacion };
      })
    );

    const variantesAceptadas: VarianteAceptada[] = [];
    const variantesDescartadas: VarianteDescartada[] = [];
    let contador = 0;

    for (const item of porExplicacion) {
      if (!item) continue;
      for (const v of asArray(item.result.variantesAceptadas)) {
        if (!v.descripcion?.trim()) continue;
        contador += 1;
        variantesAceptadas.push({
          id: `V${contador}`,
          explicacionId: item.explicacion.id,
          descripcion: v.descripcion.trim(),
        });
      }
      for (const v of asArray(item.result.variantesDescartadas)) {
        if (!v.descripcion?.trim()) continue;
        variantesDescartadas.push({
          explicacionId: item.explicacion.id,
          descripcion: v.descripcion.trim(),
          motivo: v.motivo,
        });
      }
    }

    return NextResponse.json({
      variantesAceptadas,
      variantesDescartadas,
      _debugIdentificaciones: porExplicacion
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .map((x) => ({ explicacionId: x.explicacion.id, identificacion: x.identificacion })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
