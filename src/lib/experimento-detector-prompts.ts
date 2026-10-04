import type Anthropic from "@anthropic-ai/sdk";
import { REGLA_IDIOMA } from "./prompts";

type Schema = Anthropic.Tool["input_schema"];

/**
 * Prompt del experimento temporal del detector de problemas perversos (ver
 * diagnostico/umbrales-detector.txt). NO forma parte de producción — vive acá, aparte de prompts.ts, para que
 * quede explícito que es experimental. Una sola llamada por corrida; la verificación de citas y el veredicto
 * se calculan en código (ver route.ts), nunca los decide el modelo directamente.
 */

const SENIAL_SCHEMA = {
  type: "object",
  properties: {
    valor: { type: "string", enum: ["si", "no", "indeterminado"] },
    cita: {
      type: "string",
      description:
        "Cita textual EXACTA del texto que respalda este valor. Si no hay una cita real que lo respalde, el valor debe ser \"no\".",
    },
  },
  required: ["valor", "cita"],
  additionalProperties: false,
} as const;

export function detectorPrompt(texto: string, enunciado: string) {
  const system = `
${REGLA_IDIOMA}

Tu tarea: para el problema planteado en este texto — tal como el texto mismo lo formula, no como tú lo
reformularías ni como a ti te parecería mejor plantearlo — juzga si exhibe cada una de cinco señales de
"problema perverso": un problema cuya propia FORMULACIÓN ya está en disputa, no solo su solución.

Para cada señal, reporta:
- "valor": "si", "no" o "indeterminado".
- "cita": una cita textual EXACTA del texto que respalde ese valor, copiada literalmente. Si no hay una cita
  real que lo respalde, el valor debe ser "no" — nunca reportes "si" ni "indeterminado" sin una cita real que
  lo sostenga.

Las cinco señales:

S1 — Formulación en disputa: el texto muestra o reconoce que el problema se plantea distinto según el marco o
el actor, de modo que los mismos hechos dan problemas distintos.

S2 — Hechos y valores entrelazados: responder exige elegir entre valores o fines en conflicto, no solo
establecer hechos.

S3 — Sin criterio de cierre: el texto no define una condición verificable que indique que el problema quedó
resuelto, o la solución que plantea abre nuevos problemas.

S4 — Mejor o peor, no verdadero o falso: las respuestas que el texto considera se juzgan como mejores o
peores según fines, no como ciertas o falsas.

S5 — Marcos incompatibles: el texto presenta al menos dos actores o perspectivas con objetivos que no pueden
cumplirse a la vez.

Además, reporta — sin que esto participe en ninguna decisión, es puramente descriptivo — el tipo de
formulación del problema: "explicacion" (pregunta por una causa), "meta" (pregunta por cómo lograr un
objetivo) o "pronostico" (pregunta por qué va a pasar), el que mejor describa cómo está planteado.

IMPORTANTE: tu juicio es exclusivamente sobre la ESTRUCTURA del problema tal como el texto lo plantea. NO
evalúes la verdad de ningún hecho citado en el texto, ni tu propia postura sobre el tema, ni si el problema te
parece importante — nada de eso entra en ninguna de las cinco señales.
`.trim();

  const user = `Texto:\n\n${texto}\n\nEnunciado del problema (tal como ya quedó planteado):\n${enunciado}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      s1FormulacionEnDisputa: SENIAL_SCHEMA,
      s2HechosYValores: SENIAL_SCHEMA,
      s3SinCriterioDeCierre: SENIAL_SCHEMA,
      s4MejorPeorNoVerdaderoFalso: SENIAL_SCHEMA,
      s5MarcosIncompatibles: SENIAL_SCHEMA,
      tipoFormulacion: { type: "string", enum: ["explicacion", "meta", "pronostico"] },
    },
    required: [
      "s1FormulacionEnDisputa",
      "s2HechosYValores",
      "s3SinCriterioDeCierre",
      "s4MejorPeorNoVerdaderoFalso",
      "s5MarcosIncompatibles",
      "tipoFormulacion",
    ],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "reportar_seniales_perverso",
    toolDescription:
      "Reporta las cinco señales de problema perverso (valor + cita textual cada una) y el tipo de formulación, sin calcular ningún veredicto.",
    inputSchema,
  };
}
