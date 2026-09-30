import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step4Prompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Problema, VarianteAceptada, Veredicto } from "@/lib/types";

// 230s (subido de 200, 2026-09-30): el peor caso ya era 200s con el timeoutMs default de callTool (50s) —
// la primera llamada (2×50s con su propio reintento por marcador mal formado) más, si la forma resulta
// inválida, una segunda llamada completa (otros 2×50s) — y 200 == 200 no deja ningún margen real frente al
// maxDuration anterior. 230s corrige eso sin tocar ningún timeoutMs, y queda bien por debajo de los 300s
// documentados en el plan Hobby con Fluid Compute.
export const maxDuration = 230;

/** El modelo reporta "veredicto" como un agregado autoreportado, en paralelo a resultadosVariantes — nada
 * verificaba hasta ahora que ese agregado fuera consistente con el patrón real de las variantes de tipo
 * sustitucion_minima (que son las únicas que cuentan, por instrucción del prompt). Solo LOG por ahora, sin
 * corregir nada — ver fila 4 de la auditoría de schemas (2026-09-29): primero medir si esto ocurre de
 * verdad en producción antes de invertir en forzarlo con un cálculo en código como ya se hizo para el
 * mecanismo de despojo de pasaje. */
function veredictoEsperadoPorMayoria(
  resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive" }[],
  idsSustitucionMinima: Set<string>
): "DificilDeVariar" | "FacilDeVariar" | "Mixta" | null {
  const relevantes = resultadosVariantes.filter((r) => idsSustitucionMinima.has(r.varianteId));
  if (relevantes.length === 0) return null;
  const rompe = relevantes.filter((r) => r.resultado === "rompe").length;
  const sobrevive = relevantes.length - rompe;
  if (rompe > sobrevive) return "DificilDeVariar";
  if (sobrevive > rompe) return "FacilDeVariar";
  return "Mixta";
}

type ResultadoVeredictoBruto = {
  resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive"; justificacion: string }[];
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
  justificacion: string;
  resisteConocimientoNuevo?: { resultado: "rompe" | "sobrevive"; justificacion: string };
};

/** Confirmado en un registro real de producción (análisis "Así no, Mister Trump", explicación E3,
 * 2026-09-29): resultadosVariantes venía vacío pese a un veredicto que no es SinSustitutoGenuino (ese valor
 * ni siquiera es una salida posible del modelo acá — solo lo asigna esta ruta cuando variantes.length es 0,
 * ANTES de llamar a callTool — así que si llegamos hasta acá, resultadosVariantes vacío es siempre inválido),
 * y resisteConocimientoNuevo era un string suelto con sintaxis de tool-call filtrada, no el objeto esperado.
 * callTool ya filtra los tres marcadores de tool-call mal formado en cualquier string (ver anthropic.ts) —
 * esto valida además la FORMA específica de este paso, que esa capa genérica no puede conocer. */
function formaInvalidaDe(result: ResultadoVeredictoBruto): string | null {
  if (asArray(result.resultadosVariantes).length === 0) {
    return "resultadosVariantes vacío con un veredicto que no es SinSustitutoGenuino";
  }
  if (result.resisteConocimientoNuevo != null) {
    const r = result.resisteConocimientoNuevo;
    const formaValida =
      typeof r === "object" &&
      r !== null &&
      (r.resultado === "rompe" || r.resultado === "sobrevive") &&
      typeof r.justificacion === "string" &&
      r.justificacion.trim().length > 0;
    if (!formaValida) return "resisteConocimientoNuevo con forma inválida";
  }
  return null;
}

export async function POST(request: Request) {
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

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final — mismo riesgo de conexión inactiva
  // ya confirmado en step2 con un artículo largo real, agravado acá por el reintento propio de forma.
  return crearRespuestaSse(request, "step4", async (enviar) => {
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
            resisteConocimientoNuevo: null,
          };
        }

        const prompt = step4Prompt(texto, explicacion, problema, variantes);
        let result = await callTool<ResultadoVeredictoBruto>(prompt);
        let problemaForma = formaInvalidaDe(result);
        if (problemaForma) {
          console.error(
            `[step4] respuesta con forma inválida (${problemaForma}) para la explicación ${explicacion.id} — reintentando una vez.`
          );
          result = await callTool<ResultadoVeredictoBruto>(prompt);
          problemaForma = formaInvalidaDe(result);
          if (problemaForma) {
            throw new Error(
              `No se pudo generar un veredicto con forma válida para la explicación ${explicacion.id} (${problemaForma}), incluso después de reintentar. No se guardó nada — intenta de nuevo.`
            );
          }
        }

        const resultadosVariantes = asArray(result.resultadosVariantes);
        const idsSustitucionMinima = new Set(
          variantes.filter((v) => v.tipo === "sustitucion_minima").map((v) => v.id)
        );
        const veredictoEsperado = veredictoEsperadoPorMayoria(resultadosVariantes, idsSustitucionMinima);
        if (veredictoEsperado && veredictoEsperado !== result.veredicto) {
          console.error(
            `[step4] veredicto autoreportado ("${result.veredicto}") diverge del patrón real de resultadosVariantes (mayoría sugiere "${veredictoEsperado}") — explicación ${explicacion.id}. Solo registro, no se corrige.`
          );
        }

        return {
          explicacionId: explicacion.id,
          resultadosVariantes,
          veredicto: result.veredicto,
          justificacion: result.justificacion,
          resisteConocimientoNuevo: result.resisteConocimientoNuevo ?? null,
        };
      })
    );

    const veredictos: Veredicto[] = porExplicacion.filter((v): v is Veredicto => v !== null);

    enviar({ veredictos });
  });
}
