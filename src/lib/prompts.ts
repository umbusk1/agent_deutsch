import type Anthropic from "@anthropic-ai/sdk";
import type { Explicacion, Problema, VarianteAceptada, Veredicto, Relacion } from "./types";

type Schema = Anthropic.Tool["input_schema"];

const CRITERIO_CENTRAL = `
Estás evaluando la calidad de explicaciones dentro de un texto de opinión, usando un criterio preciso:

Una explicación es BUENA cuando es DIFÍCIL DE VARIAR en relación con el problema específico que resuelve.
"Difícil de variar" significa: si le cambias los detalles (los mecanismos, actores, causas concretas que propone),
deja de resolver el problema — cada parte de la explicación está haciendo un trabajo específico y necesario.

Una explicación es MALA (fácil de variar) cuando puedes cambiarle los detalles y, sin embargo, sigue "explicando"
el problema igual de bien que antes. Eso revela que los detalles nunca estaban conectados de verdad con el problema:
la explicación funcionaba más como una fórmula flexible que como una respuesta real.

Este criterio nunca debe nombrarse explícitamente en ningún texto dirigido al usuario final. No menciones autores,
escuelas de pensamiento ni terminología técnica (como "difícil de variar", "conjetura", "falsable", etc.) fuera de
los campos estructurados que se te piden. El usuario final debe leer prosa crítica ordinaria, no un tratado de
epistemología.
`.trim();

export function step1Prompt(texto: string) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: leer un texto de opinión y extraer las afirmaciones que funcionan como EXPLICACIONES
(intentos de responder "por qué ocurre X" o "qué mecanismo produce X"), distinguiéndolas de:
- narración/descripción: relatar qué pasó o cómo son las cosas, sin proponer una causa o mecanismo.
- juicio normativo puro: afirmar qué debería pasar o qué es deseable/indeseable, sin explicar por qué ocurre algo.

Para cada afirmación explicativa candidata, cita el fragmento exacto del texto y resume la explicación en una frase.
Para cada afirmación descartada por ser narración, descripción o juicio normativo puro, cita el fragmento y explica
brevemente por qué no cuenta como explicación.

Sé exhaustivo pero no inventes explicaciones que el texto no contiene.
`.trim();

  const user = `Texto a analizar:\n\n${texto}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      candidatas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cita: { type: "string", description: "Fragmento textual citado del artículo" },
            resumen: { type: "string", description: "Resumen breve de la afirmación explicativa" },
          },
          required: ["cita", "resumen"],
        },
      },
      descartadas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cita: { type: "string" },
            tipo: { type: "string", enum: ["narracion", "descripcion", "juicio_normativo"] },
            motivo: { type: "string" },
          },
          required: ["cita", "tipo", "motivo"],
        },
      },
    },
    required: ["candidatas", "descartadas"],
  };

  return {
    system,
    user,
    toolName: "reportar_extraccion",
    toolDescription: "Reporta las explicaciones candidatas y las afirmaciones descartadas.",
    inputSchema,
  };
}

export function step2Prompt(texto: string, explicaciones: Explicacion[]) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: para cada explicación candidata que se te entrega, formular explícitamente el PROBLEMA
o conflicto de ideas que esa explicación pretende resolver. El problema debe formularse como una pregunta concreta
(ej. "¿por qué la participación electoral cayó en la región X durante la década Y?"), lo bastante específica como
para poder evaluar después si una variante de la explicación sigue respondiéndola o no.

Sin un problema bien formulado no se puede evaluar la calidad de la explicación, así que sé preciso y específico,
evitando formulaciones vagas o demasiado generales.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicaciones candidatas:\n${JSON.stringify(
    explicaciones.map((e) => ({ id: e.id, cita: e.cita, resumen: e.resumen })),
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      problemas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            explicacionId: { type: "string" },
            enunciado: { type: "string", description: "El problema formulado como pregunta específica" },
          },
          required: ["explicacionId", "enunciado"],
        },
      },
    },
    required: ["problemas"],
  };

  return {
    system,
    user,
    toolName: "reportar_problemas",
    toolDescription: "Reporta el problema que cada explicación pretende resolver.",
    inputSchema,
  };
}

export function step3Prompt(texto: string, explicacion: Explicacion, problema: Problema) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: generar 2 o 3 VARIANTES de los detalles de la explicación dada, cambiando los mecanismos,
actores o causas concretas que propone, manteniendo el mismo problema como referencia.

Antes de aceptar una variante como válida, verifica que sea un SUSTITUTO GENUINO: debe competir por resolver
EXACTAMENTE el mismo problema que la explicación original. Si una variante en realidad resuelve un problema
distinto (es COMPLEMENTARIA, no rival), descártala explicando por qué.

Reporta las variantes aceptadas (sustitutos genuinos) por separado de las descartadas (complementarias u otras
razones), con su motivo de descarte.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { id: explicacion.id, cita: explicacion.cita, resumen: explicacion.resumen },
    null,
    2
  )}\n\nProblema que pretende resolver:\n${problema.enunciado}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      variantesAceptadas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción de la variante (sustituto genuino)" },
          },
          required: ["descripcion"],
        },
      },
      variantesDescartadas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string" },
            motivo: { type: "string", description: "Por qué se descarta (ej. es complementaria, no sustituta)" },
          },
          required: ["descripcion", "motivo"],
        },
      },
    },
    required: ["variantesAceptadas", "variantesDescartadas"],
  };

  return {
    system,
    user,
    toolName: "reportar_variantes",
    toolDescription: "Reporta las variantes aceptadas y descartadas de una explicación.",
    inputSchema,
  };
}

export function step4Prompt(
  texto: string,
  explicacion: Explicacion,
  problema: Problema,
  variantes: VarianteAceptada[]
) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: evaluar, para cada variante, si al ponerla a prueba contra el problema original TODAVÍA
lo resuelve ("sobrevive" → la explicación es fácil de variar en ese aspecto, señal de debilidad) o DEJA de
resolverlo ("rompe" → la explicación es difícil de variar en ese aspecto, señal de fuerza).

Después, con base en el patrón de resultados de todas las variantes, da un veredicto global para la explicación:
- "DificilDeVariar": la mayoría o todas las variantes rompen (la explicación es fuerte).
- "FacilDeVariar": la mayoría o todas las variantes sobreviven (la explicación es débil).
- "Mixta": resultados mezclados, sin un patrón claro.

Justifica el veredicto con una frase que sintetice el patrón observado.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { id: explicacion.id, resumen: explicacion.resumen },
    null,
    2
  )}\n\nProblema:\n${problema.enunciado}\n\nVariantes a evaluar:\n${JSON.stringify(
    variantes.map((v) => ({ id: v.id, descripcion: v.descripcion })),
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      resultadosVariantes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            varianteId: { type: "string" },
            resultado: { type: "string", enum: ["rompe", "sobrevive"] },
            justificacion: { type: "string" },
          },
          required: ["varianteId", "resultado", "justificacion"],
        },
      },
      veredicto: { type: "string", enum: ["DificilDeVariar", "FacilDeVariar", "Mixta"] },
      justificacion: { type: "string" },
    },
    required: ["resultadosVariantes", "veredicto", "justificacion"],
  };

  return {
    system,
    user,
    toolName: "reportar_veredicto",
    toolDescription: "Reporta el resultado de cada variante y el veredicto global de la explicación.",
    inputSchema,
  };
}

export function step5Prompt(
  texto: string,
  explicaciones: Explicacion[],
  problemas: Problema[],
  veredictos: Veredicto[]
) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: para las explicaciones con veredicto "DificilDeVariar" o "Mixta" (las explicaciones fuertes
o parcialmente fuertes), generar 1 o 2 PROBLEMAS NUEVOS que solo se vuelven formulables si se acepta esa
explicación como cierta. Es decir: preguntas que no tendrían sentido plantear sin aceptar primero la explicación,
porque dependen de un mecanismo o entidad que la explicación introduce.

Filtra cualquier pregunta que ya fuera formulable antes de aceptar la explicación (esas no cuentan).

Para cada problema nuevo, indica si el autor del texto lo reconoce o lo aborda explícitamente ("Si") o lo deja
completamente silenciado/sin mencionar ("No"), con una breve justificación.

Para las explicaciones con veredicto "FacilDeVariar" no generes problemas nuevos: devuélvelas con una lista vacía.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicaciones con su problema y veredicto:\n${JSON.stringify(
    explicaciones.map((e) => ({
      id: e.id,
      resumen: e.resumen,
      problema: problemas.find((p) => p.explicacionId === e.id)?.enunciado,
      veredicto: veredictos.find((v) => v.explicacionId === e.id)?.veredicto,
    })),
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      resultados: {
        type: "array",
        items: {
          type: "object",
          properties: {
            explicacionId: { type: "string" },
            problemasNuevos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  enunciado: { type: "string" },
                  reconocidoPorAutor: { type: "string", enum: ["Si", "No"] },
                  justificacion: { type: "string" },
                },
                required: ["enunciado", "reconocidoPorAutor", "justificacion"],
              },
            },
          },
          required: ["explicacionId", "problemasNuevos"],
        },
      },
    },
    required: ["resultados"],
  };

  return {
    system,
    user,
    toolName: "reportar_problemas_nuevos",
    toolDescription: "Reporta los problemas nuevos generados por cada explicación fuerte.",
    inputSchema,
  };
}

export function step6Prompt(explicaciones: Explicacion[], problemas: Problema[]) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: cuando haya más de una explicación comparable en el texto, determinar si compiten por
resolver EL MISMO problema (son SUSTITUTAS/rivales genuinas, "compite_con") o si en realidad resuelven problemas
distintos y pueden convivir sin contradecirse (son "complementa").

Solo reporta pares de explicaciones que sean realmente comparables (que aborden problemas iguales o muy cercanos).
No fuerces una relación entre explicaciones que tratan asuntos completamente distintos.
`.trim();

  const user = `Explicaciones y sus problemas:\n${JSON.stringify(
    explicaciones.map((e) => ({
      id: e.id,
      resumen: e.resumen,
      problema: problemas.find((p) => p.explicacionId === e.id)?.enunciado,
    })),
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      relaciones: {
        type: "array",
        items: {
          type: "object",
          properties: {
            explicacionAId: { type: "string" },
            explicacionBId: { type: "string" },
            tipo: { type: "string", enum: ["compite_con", "complementa"] },
            justificacion: { type: "string" },
          },
          required: ["explicacionAId", "explicacionBId", "tipo", "justificacion"],
        },
      },
    },
    required: ["relaciones"],
  };

  return {
    system,
    user,
    toolName: "reportar_relaciones",
    toolDescription: "Reporta las relaciones de competencia o complementariedad entre explicaciones.",
    inputSchema,
  };
}

export function step7Prompt(
  texto: string,
  explicaciones: Explicacion[],
  problemas: Problema[],
  veredictos: Veredicto[],
  problemasNuevosPorExplicacion: Map<string, { enunciado: string; reconocidoPorAutor: string }[]>,
  relaciones: Relacion[]
) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: redactar el REPORTE FINAL en prosa crítica, dirigido al autor o a un lector interesado en
la calidad argumentativa del texto. El reporte debe:

- Estar completamente en español, en Markdown, organizado con encabezados por explicación relevante.
- Mostrar el razonamiento de forma auditable: qué se probó (qué variantes se consideraron) y qué sobrevivió o se
  rompió, en prosa natural — sin tablas de veredictos crudos ni jerga técnica.
- NUNCA mencionar a David Deutsch, Karl Popper, "difícil de variar", "falsable", "conjetura" ni ningún término
  técnico del método. Usa lenguaje llano: "esta explicación resiste el cambio de sus detalles porque...", "esta
  explicación podría reemplazar sus causas propuestas por otras y seguiría sonando igual de convincente, lo cual
  sugiere que no está realmente conectada con lo que dice explicar...".
- Señalar, para las explicaciones fuertes, qué preguntas nuevas abre y si el autor las reconoce o las deja de lado.
- Si hay explicaciones rivales o complementarias, explicar esa relación en prosa.
- Cerrar con una valoración general breve de la calidad explicativa del texto.

No incluyas los datos crudos (IDs, listas estructuradas) en el reporte: tradúcelos a prosa legible.
`.trim();

  const user = `Texto original:\n\n${texto}\n\nDatos del análisis (uso interno, tradúcelos a prosa):\n${JSON.stringify(
    {
      explicaciones: explicaciones.map((e) => ({
        id: e.id,
        resumen: e.resumen,
        cita: e.cita,
        problema: problemas.find((p) => p.explicacionId === e.id)?.enunciado,
        veredicto: veredictos.find((v) => v.explicacionId === e.id),
        problemasNuevos: problemasNuevosPorExplicacion.get(e.id) ?? [],
      })),
      relaciones,
    },
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      reporte: { type: "string", description: "Reporte completo en prosa crítica, formato Markdown" },
    },
    required: ["reporte"],
  };

  return {
    system,
    user,
    toolName: "reportar_analisis_final",
    toolDescription: "Reporta el texto final del reporte crítico en prosa.",
    inputSchema,
  };
}
