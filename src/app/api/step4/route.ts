import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step4Prompt } from "@/lib/prompts";
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
      explicaciones.map(async (explicacion) => {
        const problema = problemas.find((p) => p.explicacionId === explicacion.id);
        if (!problema) return null;

        const variantes = (variantesAceptadas ?? []).filter((v) => v.explicacionId === explicacion.id);
        if (variantes.length === 0) {
          return {
            explicacionId: explicacion.id,
            resultadosVariantes: [],
            veredicto: "DificilDeVariar" as const,
            justificacion:
              "No fue posible proponer ninguna variante que compitiera genuinamente por resolver el mismo problema: cualquier cambio de detalles considerado terminaba resolviendo un problema distinto. Eso en sí mismo es indicio de que la explicación está fuertemente atada a los detalles que propone.",
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
          resultadosVariantes: result.resultadosVariantes ?? [],
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
