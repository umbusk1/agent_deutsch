import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step3IdentificarPrompt, step3VariantesPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Problema, VarianteAceptada, VarianteDescartada, IdentificacionVariante } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
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

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final: cada explicación hace dos llamadas
  // secuenciales sobre el artículo completo, y con varias explicaciones en paralelo el navegador puede pasar
  // 30s+ sin recibir ningún byte — mismo riesgo ya confirmado en step2 con un artículo largo real.
  return crearRespuestaSse(request, "step3", async (enviar) => {
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
          candidatosBrutos: string[];
          variantesAceptadas: {
            descripcion: string;
            tipo?: "sustitucion_minima" | "conocimiento_nuevo";
            elementoFijoVerificado?: string;
          }[];
          variantesDescartadas: { descripcion: string; motivo: string }[];
        }>(variantesPrompt);

        return { explicacion, result };
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
          // Sin strict:true en esta tool, "required" no se aplica de verdad — si el modelo omite tipo,
          // asumimos el caso normal en vez de dejarlo sin marcar.
          tipo: v.tipo === "conocimiento_nuevo" ? "conocimiento_nuevo" : "sustitucion_minima",
          elementoFijoVerificado: v.elementoFijoVerificado?.trim() ?? "",
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

    enviar({ variantesAceptadas, variantesDescartadas });
  });
}
