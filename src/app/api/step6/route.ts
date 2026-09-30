import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step6Prompt, paresMismoProblema, claveRelacionMismoProblema } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Problema, Relacion } from "@/lib/types";

// 120s: 1 sola llamada, sin reintento propio de aplicación — peor caso 2×50s = 100s (con el timeoutMs
// default de callTool, sin tocar), ya cubierto por este valor sin necesidad de subirlo (auditoría
// 2026-09-30). Bien por debajo de los 300s documentados en el plan Hobby con Fluid Compute.
export const maxDuration = 120;

type RelacionObligatoria = { tipo?: "compite_con" | "complementa"; justificacion?: string };
type RelacionAdicional = {
  explicacionAId: string;
  explicacionBId: string;
  tipo: "compite_con" | "complementa";
  justificacion: string;
};

export async function POST(request: Request) {
  const { explicaciones, problemas } = (await request.json()) as {
    explicaciones: Explicacion[];
    problemas: Problema[];
  };
  if (!explicaciones || explicaciones.length < 2) {
    return NextResponse.json({ relaciones: [] as Relacion[] });
  }

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final — mismo riesgo de conexión inactiva
  // ya confirmado en step2 con un artículo largo real; el esquema de esta ruta además crece combinatorio con
  // pares que comparten problemaId (ver TODO junto a paresMismoProblema en prompts.ts).
  return crearRespuestaSse(request, "step6", async (enviar) => {
    const pares = paresMismoProblema(explicaciones);
    const prompt = step6Prompt(explicaciones, problemas);
    const result = await callTool<Record<string, unknown>>(prompt);

    const relaciones: Relacion[] = [];

    for (const [a, b] of pares) {
      // Sin strict:true la API no fuerza de verdad la presencia de esta clave — si el modelo la omite bajo
      // presión (mismo patrón que candidatosBrutos y razonamientoDiagnostico, ver TODO en anthropic.ts), no
      // inventamos una relación: el par se pierde de forma visible (ausente) en vez de aparecer con datos falsos.
      const entrada = result[claveRelacionMismoProblema(a.id, b.id)] as RelacionObligatoria | undefined;
      if (entrada?.tipo && entrada.justificacion?.trim()) {
        relaciones.push({
          explicacionAId: a.id,
          explicacionBId: b.id,
          tipo: entrada.tipo,
          justificacion: entrada.justificacion.trim(),
        });
      }
    }

    for (const r of asArray(result.relacionesAdicionales as RelacionAdicional[] | undefined)) {
      if (!r.explicacionAId?.trim() || !r.explicacionBId?.trim() || r.explicacionAId === r.explicacionBId) continue;
      relaciones.push({
        explicacionAId: r.explicacionAId,
        explicacionBId: r.explicacionBId,
        tipo: r.tipo,
        justificacion: r.justificacion,
      });
    }

    enviar({ relaciones });
  });
}
