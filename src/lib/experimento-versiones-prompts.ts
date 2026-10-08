import type Anthropic from "@anthropic-ai/sdk";
import { REGLA_IDIOMA } from "./prompts";

type Schema = Anthropic.Tool["input_schema"];

/**
 * Prompt y verificación de citas del experimento temporal de comparación entre versiones (Prueba 2).
 * NO forma parte de producción — vive acá, aparte de prompts.ts, para que quede explícito que es
 * experimental. Una sola llamada por corrida. Las citas se verifican en código (ver route.ts).
 *
 * Criterio congelado el 2026-10-08 (documento "Prueba 2: comparación entre versiones"): el texto del
 * prompt, las categorías, el esquema y la regla de verificación de citas NO se cambian a la vista de los
 * resultados. Lo único que se suma al texto congelado es REGLA_IDIOMA al comienzo del prompt del sistema,
 * igual que en el detector.
 */

export const TIPOS_CAMBIO = [
  "cosmetico",
  "problema",
  "explicacion_anadida",
  "explicacion_quitada",
  "varios",
] as const;
export type TipoCambio = (typeof TIPOS_CAMBIO)[number];

export type CitaVerificada = {
  texto: string;
  vacia: boolean;
  valida: boolean | null; // null cuando la cita está vacía
  partes: number;
};

// COPIA TEXTUAL de normalizar() de experimento-detector/route.ts (no reescribir).
// Sin distinguir mayúsculas, espacios extra, variantes Unicode de un mismo carácter (NFKC), comillas rectas
// vs. curvas, rayas (guion/en dash/em dash) ni puntos suspensivos sueltos vs. el carácter unicode "…".
export function normalizar(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Regla congelada: la cita se divide por "..." o "…". Cada parte se normaliza. Se ignoran las partes de
// menos de 4 caracteres tras normalizar. La cita es válida solo si TODAS las partes que quedan están, ya
// normalizadas, en el texto normalizado. Una cita vacía no es válida ni inválida.
export function verificarCitaConPartes(cita: unknown, texto: string): CitaVerificada {
  const original = typeof cita === "string" ? cita : "";
  if (!original.trim()) {
    return { texto: original, vacia: true, valida: null, partes: 0 };
  }
  const textoNormalizado = normalizar(texto);
  const partes = original
    .split(/\.\.\.|…/)
    .map((parte) => normalizar(parte))
    .filter((parte) => parte.length >= 4);
  if (partes.length === 0) {
    return { texto: original, vacia: false, valida: false, partes: 0 };
  }
  const valida = partes.every((parte) => textoNormalizado.includes(parte));
  return { texto: original, vacia: false, valida, partes: partes.length };
}

export function versionesPrompt(textoV1: string, textoV2: string) {
  const system = `
${REGLA_IDIOMA}

Eres un analista de textos. Recibes dos versiones de un mismo texto: la VERSIÓN 1 (original) y la VERSIÓN 2 (resultado de modificar la versión 1). Tu tarea es identificar qué cambió entre ellas y clasificar el cambio.

Categorías (elige una sola):
- cosmetico: la versión 2 dice lo mismo que la versión 1 con otras palabras. No se añade ni se quita ninguna afirmación, razón, mecanismo ni pregunta.
- problema: cambia la pregunta o el problema que el texto se plantea (en el título, en la pregunta inicial o en el planteamiento), aunque el resto del texto siga igual.
- explicacion_anadida: la versión 2 agrega una explicación, razón o mecanismo que la versión 1 no tenía.
- explicacion_quitada: la versión 2 elimina una explicación, razón o mecanismo que la versión 1 tenía.
- varios: hay más de un cambio de fondo, de tipos distintos.

Reglas:
1. Compara el contenido, no la forma. Si lo único que cambia es la redacción, responde cosmetico. No inventes cambios.
2. Las citas deben ser fragmentos exactos y literales del texto correspondiente (de la versión 1 en citaV1, de la versión 2 en citaV2), sin corregir ni traducir. Si necesitas unir dos fragmentos separados, sepáralos con "...". Usa fragmentos cortos, de una frase o menos cuando puedas.
3. citaV1: el fragmento de la versión 1 que cambió o fue quitado. Déjalo vacío si el cambio solo agrega texto nuevo.
4. citaV2: el fragmento de la versión 2 que cambió o fue añadido. Déjalo vacío si el cambio solo quita texto.
5. En comentario escribe de 2 a 4 frases en español: qué cambió y si el cambio parece volver la explicación más o menos fácil de variar (es decir, si las piezas de la explicación quedan más o menos intercambiables por otras) y por qué. Si no puedes saberlo, dilo.
`.trim();

  const user = `<version_1>
${textoV1}
</version_1>

<version_2>
${textoV2}
</version_2>`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      tipoCambio: { type: "string", enum: [...TIPOS_CAMBIO] },
      citaV1: { type: "string" },
      citaV2: { type: "string" },
      comentario: { type: "string" },
    },
    required: ["tipoCambio", "citaV1", "citaV2", "comentario"],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "clasificar_cambio",
    toolDescription:
      "Clasifica el cambio entre la versión 1 y la versión 2 de un texto en una sola categoría, con una cita literal de cada versión y un comentario.",
    inputSchema,
  };
}
