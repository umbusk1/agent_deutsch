import type Anthropic from "@anthropic-ai/sdk";
import { REGLA_IDIOMA } from "./prompts";
import { TIPOS_CAMBIO_VERSION } from "./versiones-comparar";
import type { Explicacion, Problema } from "./types";

type Schema = Anthropic.Tool["input_schema"];

/**
 * Prompts de la comparación entre versiones (producto, no experimento). Son DOS llamadas independientes:
 * (1) la lista de cambios entre los dos textos, (2) el emparejamiento de explicaciones entre versiones.
 *
 * Los ejemplos de estos prompts son inventados y NO son ninguno de los casos de aceptación del documento de
 * diseño: usar un caso de la prueba como ejemplo del prompt contaminaría la prueba.
 *
 * A diferencia del prompt de la Prueba 2, el comentario NO pregunta si el cambio vuelve la explicación "más o
 * menos fácil de variar": en esa prueba los comentarios tendieron a decir "más detalle = más firme", que se
 * parece a la heurística que ya falló en el detector. Qué pasó con la firmeza lo dicen los resultados del
 * análisis de cada versión (ver calcularTransiciones), no el comentario.
 */

export function cambiosPrompt(textoAnterior: string, textoNuevo: string) {
  const system = `
${REGLA_IDIOMA}

Eres un analista de textos. Recibes dos versiones de un mismo texto: la VERSIÓN ANTERIOR y la VERSIÓN NUEVA (resultado de modificar la anterior). Tu tarea es listar TODOS los cambios de fondo entre ellas, uno por uno, y clasificar cada uno.

Tipos de cambio (cada elemento de la lista lleva uno solo):
- cosmetico: la versión nueva dice lo mismo con otras palabras. No se añade ni se quita ninguna afirmación, razón, mecanismo, dato ni pregunta.
- problema: cambia la pregunta o el problema que el texto se plantea (en el título, en la pregunta inicial o en el planteamiento), aunque el resto siga igual.
- explicacion_anadida: la versión nueva agrega una explicación, razón o mecanismo que la anterior no tenía (algo que dice POR QUÉ o CÓMO ocurre algo).
- explicacion_quitada: la versión nueva elimina una explicación, razón o mecanismo que la anterior tenía.
- contenido_sin_explicacion: la versión nueva agrega (o quita) un ejemplo, un dato, una cifra, una anécdota o una opinión que NO explica por qué ocurre nada. Es información o postura, no mecanismo.
- afirmacion_modificada: cambia una palabra, una cifra o un cuantificador y con eso cambia lo que el texto AFIRMA, aunque la frase se vea casi igual (por ejemplo "aumenta" por "disminuye", o "todos" por "algunos"). Si el sentido de la afirmación cambia, NO es cosmetico.

Reglas:
1. Lista cada cambio por separado. Si en una misma zona hay dos ediciones distintas, son dos elementos. Si hay varios cambios del mismo tipo en lugares distintos, también son elementos distintos. No los agrupes.
2. Compara el contenido, no la forma. Si lo único que cambia es la redacción y el sentido es el mismo, es cosmetico. No inventes cambios: si las dos versiones dicen lo mismo, devuelve una lista vacía.
3. Las citas deben ser fragmentos exactos y literales del texto correspondiente (de la versión anterior en citaAnterior, de la versión nueva en citaNueva), sin corregir ni traducir. Si necesitas unir dos fragmentos separados, sepáralos con "...". Usa fragmentos cortos, de una frase o menos cuando puedas.
4. citaAnterior: el fragmento de la versión anterior que cambió o fue quitado. Déjalo vacío si el cambio solo agrega texto nuevo.
5. citaNueva: el fragmento de la versión nueva que cambió o fue añadido. Déjalo vacío si el cambio solo quita texto.
6. En comentario escribe una o dos frases en español que digan QUÉ cambió, con precisión. No opines sobre si el cambio mejora o empeora el texto, ni sobre qué tan sólida queda una explicación.
`.trim();

  const user = `<version_anterior>
${textoAnterior}
</version_anterior>

<version_nueva>
${textoNuevo}
</version_nueva>`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      cambios: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: [...TIPOS_CAMBIO_VERSION] },
            citaAnterior: { type: "string" },
            citaNueva: { type: "string" },
            comentario: { type: "string" },
          },
          required: ["tipo", "citaAnterior", "citaNueva", "comentario"],
          additionalProperties: false,
        },
      },
    },
    required: ["cambios"],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "listar_cambios",
    toolDescription:
      "Lista todos los cambios de fondo entre la versión anterior y la versión nueva de un texto, cada uno con su tipo, una cita literal de cada versión y un comentario.",
    inputSchema,
  };
}

type ExplicacionConProblema = Pick<Explicacion, "id" | "cita" | "resumen" | "problemaId">;

function describirExplicaciones(exp: ExplicacionConProblema[], problemas: Problema[]): string {
  if (exp.length === 0) return "(ninguna)";
  return exp
    .map((e) => {
      const problema = problemas.find((p) => p.id === e.problemaId);
      return `- ${e.id} | problema: ${problema?.enunciado ?? "(desconocido)"}\n  cita: ${e.cita}\n  resumen: ${e.resumen}`;
    })
    .join("\n");
}

export function parejasPrompt(
  anteriores: ExplicacionConProblema[],
  problemasAnteriores: Problema[],
  nuevas: ExplicacionConProblema[],
  problemasNuevos: Problema[]
) {
  const system = `
${REGLA_IDIOMA}

Recibes las explicaciones que un análisis encontró en la VERSIÓN ANTERIOR de un texto y las que encontró en la VERSIÓN NUEVA. Tu tarea es decir, para cada explicación de la versión nueva, cuál explicación de la versión anterior es la MISMA explicación (aunque esté reescrita, ampliada o acortada), o si no tiene pareja.

Reglas:
1. Dos explicaciones son la misma si proponen la misma razón o mecanismo para el mismo problema, aunque cambien las palabras, los ejemplos o el nivel de detalle.
2. Si la versión nueva trae una explicación que antes no existía, o si hay duda real, responde sin pareja (explicacionAnteriorId vacío). Es mejor decir "sin pareja" que adivinar.
3. Cada explicación de la versión anterior puede usarse como pareja una sola vez.
4. Devuelve una entrada por cada explicación de la versión nueva, sin omitir ninguna.
5. En razon escribe una frase en español que explique por qué son la misma explicación, o por qué no tiene pareja.
`.trim();

  const user = `<explicaciones_version_anterior>
${describirExplicaciones(anteriores, problemasAnteriores)}
</explicaciones_version_anterior>

<explicaciones_version_nueva>
${describirExplicaciones(nuevas, problemasNuevos)}
</explicaciones_version_nueva>`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      parejas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            explicacionNuevaId: { type: "string" },
            explicacionAnteriorId: { type: "string" },
            razon: { type: "string" },
          },
          required: ["explicacionNuevaId", "explicacionAnteriorId", "razon"],
          additionalProperties: false,
        },
      },
    },
    required: ["parejas"],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "emparejar_explicaciones",
    toolDescription:
      "Para cada explicación de la versión nueva, indica cuál explicación de la versión anterior es la misma, o ninguna.",
    inputSchema,
  };
}
