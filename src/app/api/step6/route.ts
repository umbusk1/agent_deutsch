import { NextResponse, after } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step6Prompt, paresMismoProblema, claveRelacionMismoProblema } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { registrarDuracion } from "@/lib/step-timings";
import type { Explicacion, Problema, Relacion } from "@/lib/types";

// 120s (subido de 60, 2026-09-30): Fluid Compute confirmado activo en el panel de Vercel, techo documentado
// de 300s en el plan Hobby — el 60s real observado antes no era un límite duro de la cuenta, era el
// comportamiento sin Fluid Compute. Ver la nota actualizada en la memoria del proyecto sobre esto.
export const maxDuration = 120;

type RelacionObligatoria = { tipo?: "compite_con" | "complementa"; justificacion?: string };
type RelacionAdicional = {
  explicacionAId: string;
  explicacionBId: string;
  tipo: "compite_con" | "complementa";
  justificacion: string;
};

export async function POST(request: Request) {
  const inicio = Date.now();
  try {
    const { explicaciones, problemas } = (await request.json()) as {
      explicaciones: Explicacion[];
      problemas: Problema[];
    };
    if (!explicaciones || explicaciones.length < 2) {
      return NextResponse.json({ relaciones: [] as Relacion[] });
    }

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

    return NextResponse.json({ relaciones });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  } finally {
    after(() => registrarDuracion("step6", Date.now() - inicio));
  }
}
