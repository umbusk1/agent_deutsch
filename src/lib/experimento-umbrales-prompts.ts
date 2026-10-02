import type Anthropic from "@anthropic-ai/sdk";
import type { Explicacion, Problema } from "./types";
import { REGLA_IDIOMA } from "./prompts";

type Schema = Anthropic.Tool["input_schema"];

/**
 * Prompts del experimento temporal de umbrales (ver diagnostico/umbrales-experimento.txt) — método B (partes +
 * reemplazo más favorable, juzgado "si"/"no"/"indeterminado") y método C (plausibilidad, solo testigo).
 * NO forman parte de producción: viven acá, aparte de prompts.ts, para que quede explícito que son
 * experimentales y no se mezclen por accidente con los prompts reales.
 */

export function metodoBPrompt(texto: string, explicacion: Explicacion, problema: Problema) {
  const system = `
${REGLA_IDIOMA}

Tu tarea: descompone esta explicación en sus partes constitutivas y, para cada parte, pon a prueba si
reemplazarla cambia las consecuencias que el propio texto o la propia explicación le atribuyen.

PASO 1 — Descompón la explicación en sus partes: identifica cada parte concreta y nombrable (un actor, un
mecanismo, un valor, una relación, un supuesto) que en principio podría ser distinta sin que el texto deje de
tener sentido. No generes partes triviales (una palabra suelta sin función explicativa) ni las fusiones todas
en una sola parte genérica.

PASO 2 — Para cada parte, nombra las CONSECUENCIAS que el texto o la explicación le atribuyen EXPLÍCITAMENTE —
nunca lo que sepas o creas cierto por fuera del texto. Si el texto no dice qué pasaría si esa parte fuera
distinta, o no es lo bastante explícito, las consecuencias quedan como "no especificadas por el texto" — no
las inventes ni las completes con conocimiento externo.

PASO 3 — Para cada parte, propón UN reemplazo que ocupe el mismo rol (otro factor, otro actor, otro mecanismo),
nunca el mismo factor con otro valor, y que el caso que se explica siga siendo el mismo. Elige el reemplazo MÁS
FAVORABLE a la explicación: el que mejor conserve las consecuencias declaradas. Si incluso el mejor reemplazo
posible las rompe, la parte está sosteniendo la explicación. Las cifras no se evalúan solas: se fusionan con la
parte que cuantifican.

PASO 4 — Juzga, para cada parte, si el reemplazo elegido CAMBIA las consecuencias que el texto le atribuye:
- "si": al menos una consecuencia declarada deja de seguirse o queda contradicha por el texto.
- "no": todas las consecuencias declaradas se siguen igual.
- "indeterminado": solo si el texto no dice nada sobre las consecuencias de esa parte; no lo uses por dudar de
  si la explicación es cierta.

IMPORTANTE: tu juicio en el paso 4 es sobre la LÓGICA INTERNA de este texto — si el texto mismo sigue
sosteniendo las mismas consecuencias que afirmó, con el reemplazo puesto en el lugar de esa parte. NO es un
juicio sobre si la explicación original es verdadera ni sobre qué dice la ciencia o el mundo real fuera de este
texto — eso es irrelevante acá. Tu única pregunta: dado lo que ESTE texto afirma, ¿el reemplazo rompe esa
afirmación o no?
`.trim();

  const user = `Texto original:\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { cita: explicacion.cita, resumen: explicacion.resumen, mecanismoGeneral: explicacion.mecanismoGeneral },
    null,
    2
  )}\n\nProblema que pretende resolver:\n${problema.enunciado}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      partes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            parte: { type: "string" },
            consecuenciasAtribuidas: { type: "string" },
            reemplazo: { type: "string", description: "El texto del reemplazo elegido, para poder auditarlo." },
            cambianConsecuencias: { type: "string", enum: ["si", "no", "indeterminado"] },
            justificacion: { type: "string" },
          },
          required: ["parte", "consecuenciasAtribuidas", "reemplazo", "cambianConsecuencias", "justificacion"],
        },
      },
    },
    required: ["partes"],
  };

  return {
    system,
    user,
    toolName: "reportar_partes",
    toolDescription: "Reporta la descomposición en partes de la explicación, con el reemplazo más favorable evaluado para cada una.",
    inputSchema,
  };
}

export function metodoCPrompt(texto: string, explicacion: Explicacion, problema: Problema) {
  const system = `
${REGLA_IDIOMA}

Tu tarea es dar un juicio directo de plausibilidad sobre esta explicación — sin descomponerla en partes ni
poner a prueba ninguna sustitución. Juzga únicamente qué tan plausible te parece el mecanismo que propone,
usando tu propio criterio y conocimiento general.

Responde con una sola etiqueta:
- "plausible": el mecanismo te parece creíble y razonablemente sólido.
- "no_plausible": el mecanismo te parece poco creíble o endeble.
- "dudosa": no tienes certeza suficiente para inclinarte hacia un lado u otro.

Esto es una referencia de comparación (testigo), no un método que el producto vaya a adoptar — no apliques
ningún criterio de "difícil/fácil de variar" ni ningún test de sustitución; es un juicio de plausibilidad
general, como lo haría cualquier lector.
`.trim();

  const user = `Texto original:\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { cita: explicacion.cita, resumen: explicacion.resumen, mecanismoGeneral: explicacion.mecanismoGeneral },
    null,
    2
  )}\n\nProblema que pretende resolver:\n${problema.enunciado}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      etiqueta: { type: "string", enum: ["plausible", "no_plausible", "dudosa"] },
      justificacion: { type: "string" },
    },
    required: ["etiqueta", "justificacion"],
  };

  return {
    system,
    user,
    toolName: "reportar_plausibilidad",
    toolDescription: "Reporta un juicio directo de plausibilidad sobre la explicación, sin descomponerla ni poner a prueba sustituciones.",
    inputSchema,
  };
}
