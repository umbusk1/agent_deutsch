import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step4Prompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import type { Explicacion, Problema, VarianteAceptada, Veredicto } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { texto, explicaciones, problemas, variantesAceptadas } = (await request.json()) as {
      texto: string;
      explicaciones: Explicacion[];
      problemas: Problema[];
      variantesAceptadas: VarianteAceptada[];
    };
    if (!texto) {
      return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
    }
    if (!explicaciones?.length) {
      return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
    }
    if (!problemas?.length) {
      return NextResponse.json({ error: "No hay problemas activos." }, { status: 400 });
    }

    const porExplicacion = await Promise.all(
      explicaciones.map(async (explicacion): Promise<Veredicto | null> => {
        const problema = problemas.find((p) => p.id === explicacion.problemaId);
        if (!problema) return null;

        const variantes = asArray(variantesAceptadas).filter((v) => v.explicacionId === explicacion.id);
        if (variantes.length === 0) {
          // El Paso 3 no logró generar ninguna variante que calificara como sustituto genuino (todas las que
          // propuso resultaron complementarias u otro motivo de descarte). Esto NO es evidencia de que la
          // explicación sea difícil de variar — solo significa que no se pudo poner a prueba. Asignarle
          // DificilDeVariar aquí la haría indistinguible de una explicación que sí sobrevivió pruebas reales,
          // así que se marca con su propio estado, sin someterla al veredicto binario.
          return {
            explicacionId: explicacion.id,
            resultadosVariantes: [],
            veredicto: "SinSustitutoGenuino" as const,
            justificacion:
              "El paso anterior no logró generar ninguna variante que compitiera genuinamente por resolver el mismo problema: cualquier cambio de detalles considerado terminaba resolviendo un problema distinto. Esta explicación no fue puesta a prueba — no hay base para llamarla difícil de variar.",
          };
        }

        const prompt = step4Prompt(texto, explicacion, problema, variantes);
        const result = await callTool<{
          resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive"; justificacion: string }[];
          veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
          justificacion: string;
        }>(prompt);

        return {
          explicacionId: explicacion.id,
          resultadosVariantes: asArray(result.resultadosVariantes),
          veredicto: result.veredicto,
          justificacion: result.justificacion,
        };
      })
    );

    const veredictos: Veredicto[] = porExplicacion.filter((v): v is Veredicto => v !== null);

    return NextResponse.json({ veredictos });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
