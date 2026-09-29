import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step1BPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { calcularMecanismo, oracionesReconstruyenTexto, type EntradaAnalisisPorOracion } from "@/lib/despojo";
import type { PasajePersuasivo } from "@/lib/types";

// 150s: una sola llamada para TODO el artículo (a diferencia de Mejora-pasaje, que aísla un fragmento por
// llamada) — cada pasaje ahora trae su propio desglose oración por oración, lo que aumenta el volumen de
// salida frente a la versión anterior (mecanismo autoreportado, sin desglose): más pasajes o pasajes más
// largos ya no son solo 4 campos por uno, son 4 campos + un array de oraciones por uno. callTool ya reintenta
// internamente una vez si detecta un marcador de tool-call mal formado (ver anthropic.ts); esta ruta agrega
// su PROPIO reintento si el desglose de algún pasaje no reconstruye su propia cita — un fallo más grueso que
// el de Mejora-pasaje, porque acá una sola llamada cubre TODOS los pasajes del artículo a la vez: si uno solo
// falla la reconstrucción, se reintenta la llamada entera, no un fragmento aislado.
export const maxDuration = 150;

type PasajeBruto = {
  cita: string;
  analisisPorOracion: EntradaAnalisisPorOracion[];
  tecnicas: string[];
  justificacion: string;
};

function formaInvalidaDe(pasajes: PasajeBruto[]): string | null {
  for (const p of pasajes) {
    if (!oracionesReconstruyenTexto(asArray(p.analisisPorOracion), p.cita ?? "")) {
      return `el desglose oración por oración de un pasaje ("${(p.cita ?? "").slice(0, 60)}...") no reconstruye su propia cita`;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
    }

    const prompt = step1BPrompt(texto);
    // strict:true (con additionalProperties:false en cada nivel del schema, ver step1BPrompt en prompts.ts):
    // mismo shape que mejoraDespojoPasajePrompt, ya validado — analisisPorOracion es exactamente el campo que
    // necesita forzarse para que "required" se aplique de verdad. maxTokens explícito (el default de callTool
    // es 4096) por el mismo motivo del comentario de arriba: el desglose por oración de varios pasajes puede
    // superar el default en un artículo con varios pasajes largos.
    let result = await callTool<{ pasajes: PasajeBruto[] }>({ ...prompt, strict: true, maxTokens: 8192 });
    let pasajesBrutos = asArray(result.pasajes);
    let problemaForma = formaInvalidaDe(pasajesBrutos);
    if (problemaForma) {
      console.error(`[step1b] respuesta con forma inválida (${problemaForma}) — reintentando una vez.`);
      result = await callTool<{ pasajes: PasajeBruto[] }>({ ...prompt, strict: true, maxTokens: 8192 });
      pasajesBrutos = asArray(result.pasajes);
      problemaForma = formaInvalidaDe(pasajesBrutos);
      if (problemaForma) {
        throw new Error(
          `No se pudo generar un escaneo de persuasión confiable (${problemaForma}), incluso después de reintentar. Intenta de nuevo.`
        );
      }
    }

    // El mecanismo NUNCA lo decide el modelo directamente — se calcula acá, a partir del desglose oración por
    // oración que sí tuvo que hacer (ver calcularMecanismo en despojo.ts, mismo helper que ya usa Mejora-pasaje).
    const pasajesPersuasivos: PasajePersuasivo[] = pasajesBrutos
      .filter((p) => p.cita?.trim())
      .map((p, i) => {
        const analisisPorOracion = asArray(p.analisisPorOracion);
        return {
          id: `M${i + 1}`,
          cita: p.cita.trim(),
          mecanismo: calcularMecanismo(analisisPorOracion),
          analisisPorOracion,
          tecnicas: asArray(p.tecnicas).filter((t) => t?.trim()),
          justificacion: p.justificacion?.trim() ?? "",
        };
      });

    return NextResponse.json({ pasajesPersuasivos });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
