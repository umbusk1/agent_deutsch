import type Anthropic from "@anthropic-ai/sdk";
import type { Explicacion, Problema, VarianteAceptada, Veredicto, Relacion, PasajePersuasivo, Alcance } from "./types";

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

El texto que vas a analizar puede estar en cualquier idioma. Todos los campos de texto libre que generes (resúmenes,
enunciados de problemas, descripciones de variantes, justificaciones, etc.) deben estar SIEMPRE en español,
independientemente del idioma del texto original. La única excepción son las citas textuales extraídas literalmente
del texto ("cita"), que deben mantenerse en su idioma original sin traducir.
`.trim();

export function step1Prompt(texto: string) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: leer un texto de opinión y extraer las afirmaciones que funcionan como EXPLICACIONES
(intentos de responder "por qué ocurre X" o "qué mecanismo produce X"), distinguiéndolas de:
- narración/descripción: relatar qué pasó o cómo son las cosas, sin proponer una causa o mecanismo.
- juicio normativo puro: afirmar qué debería pasar o qué es deseable/indeseable, sin explicar por qué ocurre algo.

Para cada afirmación explicativa candidata, cita el fragmento exacto del texto y resume la explicación en una frase.
Además, distingue explícitamente DOS niveles de la misma explicación, sin fusionarlos y sin omitir detalle de
ninguno de los dos:

- mecanismoGeneral: el mecanismo UNIVERSAL que la explicación invoca — la regularidad que, en principio, operaría
  igual de bien más allá de este caso concreto, si las condiciones relevantes se repitieran en cualquier otro
  contexto. Enúncialo sin nombrar a los actores, países o hechos específicos de este texto (ej. no "el remanente
  chavista evita el escrutinio judicial", sino "un grupo cuya riqueza depende de que su origen no sea escrutado
  tiene un incentivo directo en bloquear las instituciones capaces de ese escrutinio"). Esto NO es pedir un
  resumen más corto o más vago del mismo resumen — es un enunciado distinto, al nivel del patrón general, tan
  completo y preciso en su propio nivel como el resumen lo es en el suyo.
- resumen: la aplicación específica de ese mecanismo general al caso concreto del texto (quién, qué, cuándo) — se
  mantiene igual de detallado que antes, como UNA INSTANCIA del mecanismo general, no como el mecanismo mismo.

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
            mecanismoGeneral: {
              type: "string",
              description:
                "El mecanismo universal que esta explicación invoca, enunciado sin actores/hechos específicos de este texto — la versión general de la que 'resumen' es una instancia",
            },
            resumen: {
              type: "string",
              description: "Resumen de la afirmación explicativa, como aplicación específica de mecanismoGeneral al caso concreto del texto",
            },
          },
          required: ["cita", "mecanismoGeneral", "resumen"],
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

export function step1BPrompt(texto: string) {
  const system = `
Vas a hacer una segunda lectura completa del mismo texto de opinión, con un criterio distinto al de la
extracción de explicaciones. No te bases en ninguna lista de explicaciones ni en ningún veredicto de otro
paso — parte del texto crudo, de cero.

TU TAREA

Identifica pasajes que le piden al lector dejar de cuestionar una afirmación, por cualquier vía: apelación a
lealtad/traición, urgencia que no da tiempo a pensar, autoridad que no admite pregunta, tabú, o vergüenza
anticipada por dudar. Estas cinco son ejemplos representativos, no una lista cerrada: cualquier mecanismo que
cumpla la misma función —desactivar el escrutinio crítico en vez de invitarlo— cuenta.

Evalúa TODO el texto sin excepción, incluyendo pasajes que en otro análisis se descartarían por ser narración,
descripción o juicio normativo. Esto incluye explícitamente el título y el cierre/remate del texto: aplícales el
mismo test de despojo que al resto del cuerpo — un título o un remate pueden ser, en sí mismos, una construcción
irónica que condensa (o reemplaza) el argumento central. En este punto del proceso no existe todavía ningún
veredicto de "difícil de variar" sobre ninguna explicación — no lo asumas, no lo esperes, y no uses su ausencia o
presencia como atajo para decidir nada aquí.

EL TEST OPERATIVO (tres pasos, aplícalo a cada pasaje candidato)

1. Aísla el pasaje.
2. Despójalo de la carga de lealtad/urgencia/tabú/autoridad, y quédate solo con la afirmación desnuda que hace.
3. Evalúa: ¿un lector crítico seguiría considerando esa afirmación desnuda por sus propios méritos? Si sí, el
   envoltorio era decoración — mecanismo racional, aunque el tono sea apasionado. Si no —si sin el envoltorio
   la afirmación se cae— el envoltorio era el argumento real: mecanismo anti-racional.

SALVAGUARDA DE NEUTRALIDAD (aplícala siempre, sin excepción)

Lenguaje vívido, indignación moral, metáfora, o apelación al miedo proporcionada al riesgo real, NO son
automáticamente anti-racionales. Solo cuenta cuando, al quitar el envoltorio, el argumento se cae — es decir,
cuando el envoltorio reemplaza al argumento en vez de acompañarlo. Sin esta distinción, el criterio se vuelve
un detector de "cosas dichas con pasión", lo cual sería un sesgo, no un hallazgo.

INGENIO/IRONÍA vs. SARCASMO/DESCALIFICACIÓN (aplica esto cuando el envoltorio sea humor, ironía o burla)

Estos dos fenómenos superan el test de despojo de maneras opuestas y hoy se confunden fácilmente porque ambos
"suenan" como burla. Distínguelos explícitamente:

- Ingenio o ironía que COMPRIME un argumento real: la formulación aguda, irónica o sarcástica es una forma
  económica de decir algo que, despojado de su gracia, deja una afirmación sustantiva y verificable en pie por
  sus propios méritos. El humor es el empaque, no el argumento. Esto es Racional — usa una técnica como "ironía o
  ingenio que revela una tensión real" (no la confundas con las técnicas típicamente asociadas a lo
  AntiRacional: si describes la técnica de un pasaje Racional como "apelación a lealtad/traición" o
  "descalificación de la postura contraria" sin más, revisa si en realidad el pasaje sí sobrevive el despojo —
  y si sobrevive, nombra la técnica en términos de lo que SÍ aporta —la tensión o contradicción real que expone—
  no en términos del mecanismo de presión que usarías para un caso AntiRacional).
- Sarcasmo o burla que SUSTITUYE el argumento: al despojar el pasaje de su tono burlón o desdeñoso, no queda
  ninguna afirmación verificable — solo desprecio hacia la postura o persona contraria. El desdén ocupa el lugar
  donde debería estar una razón. Esto es AntiRacional — usa una técnica como "sarcasmo o descalificación ad
  hominem que sustituye el argumento".

La pregunta que separa a los dos casos: después de quitar el tono, ¿queda una afirmación que un lector crítico
podría investigar o refutar por sus propios méritos (ingenio), o queda solo una actitud hacia el otro lado
(sarcasmo sustitutivo)? Nombra la técnica de forma consistente con esa respuesta, no con el vocabulario típico
del fenómeno contrario.

GRANULARIDAD

Cada pasaje es la unidad de análisis, no el texto completo. Un artículo puede tener nueve movimientos honestos
y uno solo que falle este test — repórtalos por separado. No estás atado a citas cortas: usa la unidad natural
(frase o párrafo) que haga falta para poder despojar el envoltorio con sentido.

QUÉ REGISTRAR POR CADA PASAJE

Registra solo los pasajes que despliegan alguna de estas vías de presión (no registres pasajes neutros que no
apelan a ninguna). Para cada uno:
- cita: el fragmento exacto del texto, en su idioma original, sin traducir.
- mecanismo: "Racional" o "AntiRacional" (binario, sin tercer estado — si el caso es ambiguo, resuélvelo con
  matiz en el texto libre de las técnicas, no inventando una categoría intermedia).
- tecnicas: una entrada por cada técnica de presión detectada en ese pasaje, en español (ej. "apelación a
  lealtad/traición", "urgencia que no da margen para pensar"). Si un mismo pasaje combina más de una vía,
  regístralas todas — no elijas una sola como dominante.
- justificacion: en español, por qué la afirmación desnuda se sostiene o se cae al quitarle el envoltorio.

Si tras leer todo el texto ningún pasaje resulta en mecanismo AntiRacional, igual puedes reportar los pasajes
con mecanismo Racional que hayas identificado (retórica apasionada que resistió el test); simplemente no forces
ningún AntiRacional que no encuentres.
`.trim();

  const user = `Texto a analizar:\n\n${texto}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      pasajes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cita: { type: "string", description: "Fragmento textual citado del artículo, en su idioma original" },
            mecanismo: { type: "string", enum: ["Racional", "AntiRacional"] },
            tecnicas: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
              description: "Una o más técnicas de presión detectadas en el pasaje, en español",
            },
            justificacion: { type: "string" },
          },
          required: ["cita", "mecanismo", "tecnicas", "justificacion"],
        },
      },
    },
    required: ["pasajes"],
  };

  return {
    system,
    user,
    toolName: "reportar_persuasion",
    toolDescription: "Reporta los pasajes que apelan a lealtad, urgencia, autoridad, tabú o vergüenza, y si ese envoltorio reemplaza o acompaña al argumento.",
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

Cada explicación viene con dos niveles ya distinguidos: mecanismoGeneral (la regularidad universal que invoca) y
resumen (su aplicación específica al caso del texto). Formula el problema al nivel de mecanismoGeneral, no al
nivel de los detalles de resumen — la pregunta debe poder tener, en principio, más de un mecanismo general
candidato como respuesta, aunque en este texto solo se defienda uno. Evita incorporar en el enunciado del
problema matices, contrastes o calificadores que solo tengan sentido dentro de la aplicación específica de ESTA
explicación al caso venezolano (incluyendo frases tomadas casi literalmente de cómo el texto original narra el
caso) — eso ata el problema a que solo esta explicación pueda satisfacerlo, y hace imposible evaluarla después
contra un rival genuino. Sigue siendo específico y evaluable (evita el otro extremo: una pregunta tan general
que ni siquiera identifique el fenómeno concreto que hay que explicar) — el nivel correcto es el del mecanismo,
no el de sus detalles de aplicación ni el de la redacción del artículo.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicaciones candidatas:\n${JSON.stringify(
    explicaciones.map((e) => ({ id: e.id, cita: e.cita, mecanismoGeneral: e.mecanismoGeneral, resumen: e.resumen })),
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

Si la explicación hace una afirmación sobre el futuro, o extrapola hacia adelante una tendencia actual, genera
SIEMPRE una variante adicional (más allá de las 2 o 3 normales) de un tipo específico: un escenario donde surge
conocimiento nuevo —una innovación, un cambio de política, un desarrollo imprevisto— que altera la trayectoria
que la explicación asume. Descríbela con suficiente detalle concreto (qué tipo de desarrollo, cómo altera la
trayectoria) para que sea evaluable como las demás. Esta variante siempre cuenta como sustituto genuino del
mismo problema, no la descartes por "ser complementaria": existe específicamente para poner a prueba si la
explicación deja espacio para que algo así ocurra.

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
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción de la variante (sustituto genuino), no vacía" },
          },
          required: ["descripcion"],
        },
      },
      variantesDescartadas: {
        type: "array",
        maxItems: 5,
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
  explicacion: Explicacion,
  problema: Problema,
  veredicto: Veredicto
) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: la explicación que recibes ya tiene veredicto "DificilDeVariar" o "Mixta" (es fuerte o
parcialmente fuerte). Genera 1 o 2 PROBLEMAS NUEVOS que solo se vuelven formulables si se acepta esa explicación
como cierta. Es decir: preguntas que no tendrían sentido plantear sin aceptar primero la explicación, porque
dependen de un mecanismo o entidad que la explicación introduce.

Filtra cualquier pregunta que ya fuera formulable antes de aceptar la explicación (esas no cuentan). Si
genuinamente no encuentras ninguna pregunta nueva que dependa de aceptar la explicación, devuelve la lista vacía
— no fuerces una.

Para cada problema nuevo, indica si el autor del texto lo reconoce o lo aborda explícitamente ("Si") o lo deja
completamente silenciado/sin mencionar ("No"), con una breve justificación.

Además, evalúa el ALCANCE de esta explicación: si es cierta, ¿qué otros casos, no mencionados por el autor,
debería explicar igual de bien esta misma lógica? Si logras identificar casos análogos genuinos que la misma
lógica explicaría, repórtalo como alcance "Amplio", con una justificación breve que nombre esos casos. Si
concluyes que la explicación es demasiado específica al caso puntual del texto y no generalizaría a nada
parecido, repórtalo como alcance "Limitado", con una justificación breve de por qué no generaliza — esto es un
hallazgo legítimo, no un fallo de este paso.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicación (veredicto: ${veredicto.veredicto}):\n${JSON.stringify(
    { id: explicacion.id, resumen: explicacion.resumen, problema: problema.enunciado },
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      problemasNuevos: {
        type: "array",
        maxItems: 2,
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
      alcance: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["Amplio", "Limitado"] },
          justificacion: { type: "string" },
        },
        required: ["tipo", "justificacion"],
      },
    },
    required: ["problemasNuevos", "alcance"],
  };

  return {
    system,
    user,
    toolName: "reportar_problemas_nuevos",
    toolDescription: "Reporta los problemas nuevos y el alcance de esta explicación fuerte.",
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

export function step7PrincipalPrompt(
  texto: string,
  explicaciones: Explicacion[],
  problemas: Problema[],
  veredictos: Veredicto[],
  problemasNuevosPorExplicacion: Map<string, { enunciado: string; reconocidoPorAutor: string }[]>,
  relaciones: Relacion[],
  alcances: Alcance[]
) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso: redactar la SECCIÓN PRINCIPAL de un reporte crítico más grande, dirigida al autor o a un
lector interesado en la calidad argumentativa del texto. Esta sección cubre las explicaciones del texto. Otro
paso, por separado, redacta la sección sobre persuasión (pasajes que apelan a lealtad, urgencia, autoridad,
tabú o vergüenza en vez de invitar al escrutinio) — no la menciones ni la anticipes, es independiente de esta.

Esta sección debe:

- Estar completamente en español, en Markdown, organizada con encabezados por explicación relevante.
- Mostrar el razonamiento de forma auditable: qué se probó (qué variantes se consideraron) y qué sobrevivió o se
  rompió, en prosa natural — sin tablas de veredictos crudos ni jerga técnica.
- NUNCA mencionar a David Deutsch, Karl Popper, "difícil de variar", "falsable", "conjetura" ni ningún término
  técnico del método. Usa lenguaje llano: "esta explicación resiste el cambio de sus detalles porque...", "esta
  explicación podría reemplazar sus causas propuestas por otras y seguiría sonando igual de convincente, lo cual
  sugiere que no está realmente conectada con lo que dice explicar...".
- Señalar, para las explicaciones fuertes, qué preguntas nuevas abre y si el autor las reconoce o las deja de lado.
- Para las explicaciones fuertes, señalar también su alcance: si la misma lógica explicaría igual de bien otros
  casos no mencionados por el autor (alcance amplio, nombra esos casos usando la justificación entregada), o si
  es específica al caso puntual del texto y no generalizaría a nada parecido (alcance limitado, explica por qué
  con la justificación entregada). Trata ambos resultados como hallazgos legítimos sobre el texto, no como una
  nota de calidad — un alcance limitado no es un defecto de la explicación.
- Si alguna explicación resulta débil (veredicto "FacilDeVariar" o "Mixta") específicamente porque no sobrevivió
  la variante que planteaba la aparición de conocimiento nuevo, una innovación, un cambio de política o un
  desarrollo imprevisto que altera la trayectoria que la explicación asume, nombra esa debilidad con esa misma
  especificidad (ej. "esta explicación no deja espacio para que conocimiento futuro cambie la trayectoria que
  asume"), en vez de decir genéricamente que "no sobrevivió una variante". Nunca uses las palabras "predicción"
  ni "profecía".
- Si hay explicaciones rivales o complementarias, explicar esa relación en prosa.
- Si una explicación tiene veredicto "SinSustitutoGenuino", trátala aparte y con menos confianza que a las
  explicaciones puestas a prueba: no se encontró ninguna alternativa genuina con la cual ponerla a competir, así
  que su solidez sigue sin verificarse — no la describas con el mismo lenguaje de solidez que usarías para una
  explicación que sí resistió el cambio de sus detalles ("resiste el cambio", "está realmente conectada con lo
  que explica"), y no le atribuyas preguntas nuevas ni alcance (no los tiene, precisamente porque no fue puesta a
  prueba). Dilo en prosa llana, por ejemplo: "esta explicación no llegó a enfrentarse a ninguna alternativa que
  compitiera genuinamente por el mismo problema, así que no es posible afirmar todavía qué tan bien resistiría un
  cambio en sus detalles." No la trates como un hallazgo negativo (no es lo mismo que "fácil de variar") ni como
  positivo (no es lo mismo que "difícil de variar") — es, literalmente, una pregunta abierta sobre el texto.

No incluyas los datos crudos (IDs, listas estructuradas) en el reporte: tradúcelos a prosa legible.

IMPORTANTE: NO escribas ninguna conclusión general, cierre ni valoración global de la calidad del texto completo
— eso lo redacta otro paso por separado, que también incorpora los hallazgos de persuasión y necesita ser la
única conclusión del reporte final. Termina tu redacción justo después de cubrir la última explicación o
relación entre explicaciones, sin resumir ni cerrar.
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
        alcance: alcances.find((a) => a.explicacionId === e.id),
      })),
      relaciones,
    },
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      seccionPrincipal: {
        type: "string",
        description: "Sección del reporte sobre las explicaciones, en prosa crítica, formato Markdown, sin cierre ni conclusión general",
      },
    },
    required: ["seccionPrincipal"],
  };

  return {
    system,
    user,
    toolName: "reportar_seccion_principal",
    toolDescription: "Reporta la sección principal (explicaciones) del reporte crítico, sin conclusión general.",
    inputSchema,
  };
}

export function step7PersuasionPrompt(pasajesAntiRacionales: PasajePersuasivo[]) {
  const system = `
Vas a redactar la SECCIÓN DE PERSUASIÓN de un reporte crítico más grande sobre un texto de opinión. Otro paso,
por separado, redacta la sección sobre la calidad de las explicaciones del texto — no la menciones ni la
anticipes, es independiente de esta.

Vas a recibir una lista de pasajes marcados como AntiRacional: pasajes que le piden al lector dejar de
cuestionar una afirmación (por lealtad, urgencia, autoridad, tabú o vergüenza anticipada) y donde, al quitarles
ese envoltorio, el argumento se cae.

Redáctalos en prosa crítica común, completamente en español, sin jerga técnica. Nunca uses las palabras "meme",
"racional" ni "anti-racional", y nunca menciones a David Deutsch. En vez de eso, describe lo que el pasaje le
hace al lector: qué le pide, por qué vía, y por qué ese envoltorio reemplaza al argumento en vez de acompañarlo
— por ejemplo: "este pasaje le pide al lector aceptar la conclusión sin dejarle margen para dudar, apelando a la
lealtad hacia X y presentando cualquier duda como una forma de traición — un envoltorio que, quitado, deja la
afirmación central sin apoyo propio."

Si la lista viene vacía, no la omitas en silencio: escribe igual una frase breve en prosa llana que lo reconozca
explícitamente (ej. "el análisis no encontró pasajes que le pidan al lector suspender el juicio en vez de
sostenerlo con razones"), sin usar jerga ni inventar un hallazgo que no hubo.

IMPORTANTE: NO escribas ninguna conclusión general ni valoración global del texto completo — eso lo redacta otro
paso por separado, que necesita ser la única conclusión del reporte final.
`.trim();

  const user = `Pasajes marcados como AntiRacional:\n${JSON.stringify(
    pasajesAntiRacionales.map((p) => ({
      cita: p.cita,
      tecnicas: p.tecnicas,
      justificacion: p.justificacion,
    })),
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      seccionPersuasion: {
        type: "string",
        description: "Sección del reporte sobre persuasión, en prosa crítica, sin cierre ni conclusión general",
      },
    },
    required: ["seccionPersuasion"],
  };

  return {
    system,
    user,
    toolName: "reportar_seccion_persuasion",
    toolDescription: "Reporta la sección de persuasión del reporte crítico, sin conclusión general.",
    inputSchema,
  };
}

export function step7EnsamblajePrompt(seccionPrincipal: string, seccionPersuasion: string) {
  const system = `
Vas a preparar solo las PIEZAS DE ENLACE de un reporte crítico ya redactado en dos secciones separadas (una
sobre la calidad de las explicaciones del texto, otra sobre pasajes que apelan a lealtad, urgencia, autoridad,
tabú o vergüenza en vez de invitar al escrutinio) — las vas a recibir completas más abajo, solo como referencia.

NO reescribas ni reproduzcas el contenido de esas dos secciones: van a insertarse tal cual, sin tocarlas. Tu
única salida son tres piezas cortas y nuevas:

- introduccion: 1-3 frases que abran el reporte completo, mencionando de forma natural que se va a hablar tanto
  de la calidad de las explicaciones como de cómo el texto trata al lector.
- transicion: 1-2 frases que conecten el final de la sección principal con el inicio de la sección de
  persuasión, solo si genuinamente hace falta para que no se sienta como un corte abrupto (si las dos secciones
  ya fluyen bien una detrás de otra, deja este campo como cadena vacía).
- cierre: una sola valoración general breve que sintetice tanto la calidad explicativa como los hallazgos de
  persuasión (cuando los haya) — esta es la única conclusión de todo el reporte, no repitas conclusiones que ya
  estén dentro de las dos secciones.

Todo en español, prosa llana, sin jerga. NUNCA menciones a David Deutsch, Karl Popper, "difícil de variar",
"falsable", "conjetura", "meme", "racional" ni "anti-racional". No inventes hallazgos que no estén ya en las dos
secciones — tu trabajo es puramente de enlace editorial, no de análisis nuevo.
`.trim();

  const user = `Sección principal (explicaciones), para contexto — no la reescribas:\n\n${seccionPrincipal}\n\nSección de persuasión, para contexto — no la reescribas:\n\n${seccionPersuasion}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      introduccion: { type: "string", description: "1-3 frases de apertura del reporte completo" },
      transicion: { type: "string", description: "1-2 frases de enlace entre secciones, o cadena vacía si no hace falta" },
      cierre: { type: "string", description: "Única valoración general de cierre del reporte completo" },
    },
    required: ["introduccion", "transicion", "cierre"],
  };

  return {
    system,
    user,
    toolName: "reportar_piezas_de_enlace",
    toolDescription: "Reporta solo la introducción, transición y cierre que enlazan las dos secciones ya redactadas.",
    inputSchema,
  };
}
