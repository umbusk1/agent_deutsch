import { callTool } from "@/lib/anthropic";
import { obtenerAnalisis } from "@/lib/analisis";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { step3IdentificarPrompt, step3VariantesPrompt, step4Prompt } from "@/lib/prompts";
import { metodoBPrompt, metodoCPrompt } from "@/lib/experimento-umbrales-prompts";
import { ETIQUETAS_VEREDICTO } from "@/lib/etiquetas";
import type { Explicacion, Problema, IdentificacionVariante, VarianteAceptada } from "@/lib/types";

// Ruta temporal de diagnóstico (ver diagnostico/umbrales-experimento.txt) — NO forma parte del producto, no
// tiene link en ninguna navegación, y no persiste nada en Redis. 300s: el piloto (1 corrida por método) corre
// cómodo; el lote completo se invoca en tandas por (explicación, método), nunca todo junto en una sola llamada.
export const maxDuration = 300;

type Metodo = "A" | "A+" | "B" | "C";

const REGLA_MISMO_CASO_FIJO = `
REGLA ADICIONAL SOLO PARA ESTE EXPERIMENTO (no aplica en producción):
(1) Exclusión explícita: si el texto original excluye explícitamente una categoría (una negación directa, "no
    X"), descarta cualquier candidato que caiga en esa categoría excluida, aunque pase el test de independencia
    lógica de arriba — repórtalo en variantesDescartadas con el motivo "excluido explícitamente por el texto".
(2) Mismo caso fijo: el caso o instancia que se explica no cambia (el mismo planeta, el mismo mito, la misma
    ley). Un candidato que cambie el caso (otro planeta, otro país, otra época) se descarta con el motivo
    "cambia el caso". Cambiar el valor de un parámetro del mismo caso sí es una sustitución válida.
`.trim();

// Límite de concurrencia simple (cola + contador) — nada de librería nueva para una ruta temporal.
function crearLimitador(maxConcurrencia: number) {
  let enVuelo = 0;
  const cola: (() => void)[] = [];
  return async function limitar<T>(fn: () => Promise<T>): Promise<T> {
    if (enVuelo >= maxConcurrencia) {
      await new Promise<void>((resolve) => cola.push(resolve));
    }
    enVuelo++;
    try {
      return await fn();
    } finally {
      enVuelo--;
      cola.shift()?.();
    }
  };
}

async function corridaMetodoA(texto: string, explicacion: Explicacion, problema: Problema, conReglasExtra: boolean) {
  const identificacionPrompt = step3IdentificarPrompt(texto, explicacion, problema);
  const identificacion = await callTool<IdentificacionVariante>(identificacionPrompt);

  const variantesPrompt = step3VariantesPrompt(texto, explicacion, problema, identificacion);
  if (conReglasExtra) {
    variantesPrompt.system = `${variantesPrompt.system}\n\n${REGLA_MISMO_CASO_FIJO}`;
  }
  const resultVariantes = await callTool<{
    candidatosBrutos: string[];
    variantesAceptadas: {
      descripcion: string;
      tipo?: "sustitucion_minima" | "conocimiento_nuevo";
      elementoFijoVerificado?: string;
    }[];
    variantesDescartadas: { descripcion: string; motivo: string }[];
  }>(variantesPrompt);

  let contador = 0;
  const variantes: VarianteAceptada[] = resultVariantes.variantesAceptadas
    .filter((v) => v.descripcion?.trim())
    .map((v) => {
      contador += 1;
      return {
        id: `V${contador}`,
        explicacionId: explicacion.id,
        descripcion: v.descripcion.trim(),
        tipo: v.tipo === "conocimiento_nuevo" ? ("conocimiento_nuevo" as const) : ("sustitucion_minima" as const),
        elementoFijoVerificado: v.elementoFijoVerificado?.trim() ?? "",
      };
    });

  if (variantes.length === 0) {
    return {
      veredicto: "SinSustitutoGenuino" as const,
      detalle: { identificacion, variantesDescartadas: resultVariantes.variantesDescartadas },
    };
  }

  const veredictoPrompt = step4Prompt(texto, explicacion, problema, variantes);
  const resultVeredicto = await callTool<{
    resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive"; justificacion: string }[];
    veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
    justificacion: string;
    resisteConocimientoNuevo?: { resultado: "rompe" | "sobrevive"; justificacion: string };
  }>(veredictoPrompt);

  return {
    veredicto: resultVeredicto.veredicto,
    detalle: {
      identificacion,
      variantes,
      variantesDescartadas: resultVariantes.variantesDescartadas,
      resultadosVariantes: resultVeredicto.resultadosVariantes,
      justificacion: resultVeredicto.justificacion,
      resisteConocimientoNuevo: resultVeredicto.resisteConocimientoNuevo ?? null,
    },
  };
}

async function corridaMetodoB(texto: string, explicacion: Explicacion, problema: Problema) {
  const prompt = metodoBPrompt(texto, explicacion, problema);
  const result = await callTool<{
    partes: {
      parte: string;
      consecuenciasAtribuidas: string;
      reemplazo: string;
      cambianConsecuencias: "si" | "no" | "indeterminado";
      justificacion: string;
    }[];
  }>(prompt);

  const s = result.partes.filter((p) => p.cambianConsecuencias === "si").length;
  const n = result.partes.filter((p) => p.cambianConsecuencias === "no").length;
  let etiqueta: string;
  if (s + n < 3) etiqueta = "Sin poner a prueba todavía";
  else if (s / (s + n) >= 0.75) etiqueta = "Firme";
  else if (s / (s + n) <= 0.4) etiqueta = "Frágil";
  else etiqueta = "Mixta";

  return { etiqueta, detalle: { partes: result.partes, s, n } };
}

async function corridaMetodoC(texto: string, explicacion: Explicacion, problema: Problema) {
  const prompt = metodoCPrompt(texto, explicacion, problema);
  const result = await callTool<{ etiqueta: "plausible" | "no_plausible" | "dudosa"; justificacion: string }>(prompt);
  const etiqueta = result.etiqueta === "plausible" ? "Firme" : result.etiqueta === "no_plausible" ? "Frágil" : "Mixta";
  return { etiqueta, detalle: result };
}

export async function POST(request: Request) {
  return crearRespuestaSse(request, "experimento-umbrales", async (enviar) => {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      enviar({ error: "No se pudo identificar al usuario." });
      return;
    }
    if (user.role !== "admin") {
      enviar({ error: "Solo un admin puede correr este experimento." });
      return;
    }

    const { analisisId, explicacionId, metodos, corridas } = (await request.json()) as {
      analisisId: string;
      explicacionId: string;
      metodos: Metodo[];
      corridas: number;
    };
    if (!analisisId || !explicacionId || !metodos?.length || !corridas) {
      enviar({ error: "Faltan analisisId, explicacionId, metodos o corridas." });
      return;
    }

    const analisis = await obtenerAnalisis(analisisId);
    if (!analisis || !analisis.texto || !analisis.explicaciones || !analisis.problemas) {
      enviar({ error: "Este análisis no tiene los datos completos que el experimento necesita." });
      return;
    }
    const explicacion = analisis.explicaciones.find((e) => e.id === explicacionId);
    const problema = explicacion ? analisis.problemas.find((p) => p.id === explicacion.problemaId) : undefined;
    if (!explicacion || !problema) {
      enviar({ error: "Explicación o problema no encontrado en este análisis." });
      return;
    }
    const texto = analisis.texto;

    const limitar = crearLimitador(3);
    const tareas: Promise<void>[] = [];

    for (const metodo of metodos) {
      for (let corrida = 1; corrida <= corridas; corrida++) {
        tareas.push(
          limitar(async () => {
            const inicio = Date.now();
            try {
              let etiqueta: string | null = null;
              let detalle: unknown = null;
              if (metodo === "A" || metodo === "A+") {
                const r = await corridaMetodoA(texto, explicacion, problema, metodo === "A+");
                etiqueta = ETIQUETAS_VEREDICTO[r.veredicto] ?? r.veredicto;
                detalle = r.detalle;
              } else if (metodo === "B") {
                const r = await corridaMetodoB(texto, explicacion, problema);
                etiqueta = r.etiqueta;
                detalle = r.detalle;
              } else {
                const r = await corridaMetodoC(texto, explicacion, problema);
                etiqueta = r.etiqueta;
                detalle = r.detalle;
              }
              enviar({ metodo, corrida, etiqueta, detalle, ms: Date.now() - inicio });
            } catch (error) {
              enviar({
                metodo,
                corrida,
                etiqueta: null,
                detalle: null,
                ms: Date.now() - inicio,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })
        );
      }
    }

    await Promise.all(tareas);
  });
}
