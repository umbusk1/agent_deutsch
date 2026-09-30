import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step5Prompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Alcance } from "@/lib/types";

// 130s (subido de 90, 2026-09-30): 1 llamada por explicación fuerte, en paralelo, sin reintento propio de
// aplicación — peor caso por explicación 2×50s = 100s (con el timeoutMs default de callTool, sin tocar). 130s
// deja margen y queda bien por debajo de los 300s documentados en el plan Hobby con Fluid Compute.
export const maxDuration = 130;

export async function POST(request: Request) {
  const { texto, explicaciones, problemas, veredictos } = (await request.json()) as {
    texto: string;
    explicaciones: Explicacion[];
    problemas: Problema[];
    veredictos: Veredicto[];
  };
  if (!texto) {
    return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
  }
  if (!explicaciones?.length) {
    return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
  }
  if (!veredictos?.length) {
    return NextResponse.json(
      { error: "No hay resultados (ninguna explicación llegó con variantes evaluadas)." },
      { status: 400 }
    );
  }

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final — mismo riesgo de conexión inactiva
  // ya confirmado en step2 con un artículo largo real.
  return crearRespuestaSse(request, "step5", async (enviar) => {
    // Una llamada por explicación fuerte (en paralelo), no una sola llamada combinada para todas: con una
    // llamada combinada, la última explicación de la lista podía quedarse sin presupuesto de salida y salir
    // sin alcance ni preguntas nuevas. Este patrón replica el de los Pasos 3 y 4.
    const porExplicacion = await Promise.all(
      explicaciones.map(async (explicacion) => {
        // "SinSustitutoGenuino" nunca fue puesta a prueba (ver step4/route.ts) — igual que "FacilDeVariar",
        // no debe recibir preguntas nuevas ni alcance: esos campos son una credencial adicional que solo le
        // corresponde a una explicación que de verdad sobrevivió el escrutinio.
        const veredicto = veredictos.find((v) => v.explicacionId === explicacion.id);
        if (!veredicto || veredicto.veredicto === "FacilDeVariar" || veredicto.veredicto === "SinSustitutoGenuino") {
          return null;
        }

        const problema = problemas.find((p) => p.id === explicacion.problemaId);
        if (!problema) return null;

        const prompt = step5Prompt(texto, explicacion, problema, veredicto);
        const result = await callTool<{
          problemasNuevos: { enunciado: string; reconocidoPorAutor: "Si" | "No"; justificacion: string }[];
          alcance?: { tipo: "Amplio" | "Limitado"; justificacion: string };
        }>({ ...prompt, effort: "medium" });

        return { explicacionId: explicacion.id, result };
      })
    );

    let contador = 0;
    const problemasNuevos: ProblemaNuevo[] = [];
    const alcances: Alcance[] = [];
    for (const item of porExplicacion) {
      if (!item) continue;
      for (const p of asArray(item.result.problemasNuevos)) {
        if (!p.enunciado?.trim()) continue;
        contador += 1;
        problemasNuevos.push({
          id: `N${contador}`,
          explicacionId: item.explicacionId,
          enunciado: p.enunciado.trim(),
          reconocidoPorAutor: p.reconocidoPorAutor,
          justificacion: p.justificacion,
        });
      }
      if (item.result.alcance?.tipo && item.result.alcance.justificacion?.trim()) {
        alcances.push({
          explicacionId: item.explicacionId,
          tipo: item.result.alcance.tipo,
          justificacion: item.result.alcance.justificacion.trim(),
        });
      }
    }

    enviar({ problemasNuevos, alcances });
  });
}
