import type Anthropic from "@anthropic-ai/sdk";
import type { Explicacion, Problema, VarianteAceptada, Veredicto, Relacion, PasajePersuasivo, Alcance } from "./types";

type Schema = Anthropic.Tool["input_schema"];

const REGLA_JERGA = `
Este criterio nunca debe nombrarse explícitamente en ningún texto dirigido al usuario final. No menciones autores,
escuelas de pensamiento ni terminología técnica (como "difícil de variar", "conjetura", "falsable", etc.) fuera de
los campos estructurados que se te piden. El usuario final debe leer prosa crítica ordinaria, no un tratado de
epistemología.
`.trim();

const REGLA_IDIOMA = `
El texto que vas a analizar puede estar en cualquier idioma. Todos los campos de texto libre que generes (resúmenes,
enunciados de problemas, descripciones de variantes, justificaciones, etc.) deben estar SIEMPRE en español,
independientemente del idioma del texto original. La única excepción son las citas textuales extraídas literalmente
del texto ("cita"), que deben mantenerse en su idioma original sin traducir.
`.trim();

const CRITERIO_EXPLICACION = `
Estás evaluando la calidad de explicaciones dentro de un texto de opinión, usando un criterio preciso:

Una explicación es BUENA cuando es DIFÍCIL DE VARIAR en relación con el problema específico que resuelve.
"Difícil de variar" significa: si le cambias los detalles (los mecanismos, actores, causas concretas que propone),
deja de resolver el problema — cada parte de la explicación está haciendo un trabajo específico y necesario.

Una explicación es MALA (fácil de variar) cuando puedes cambiarle los detalles y, sin embargo, sigue "explicando"
el problema igual de bien que antes. Eso revela que los detalles nunca estaban conectados de verdad con el problema:
la explicación funcionaba más como una fórmula flexible que como una respuesta real.
`.trim();

// TODO: de los 7 pasos que comparten este contexto, solo 3 de ellos usan CRITERIO_EXPLICACION para algo — los
// otros 4 solo necesitan REGLA_IDIOMA/REGLA_JERGA y lo traían de más (contaminación temprana: primaba el marco de
// "evaluar explicaciones" en pasos cuyo trabajo es distinto). Auditoría completa, para quien retome esto:
//   1. Problema (problemaRazonamientoPrompt/problemaEstructuraPrompt) -> NO usa la definición. Se separó en dos
//                                            llamadas ("pensar" en prosa libre, luego "estructurar") para evitar
//                                            el atajo de relleno genérico bajo presión de schema; la de
//                                            razonamiento usa REGLA_IDIOMA + REGLA_JERGA, la de estructurar solo
//                                            REGLA_IDIOMA (transcribe texto ya limpio del paso anterior).
//   2. Explicación (explicacionPrompt)   -> NO usa la definición (clasifica candidatas y chequea el puente, no
//                                            evalúa si son difíciles de variar). Ya recortado.
//   3. Variantes (step3Prompt)           -> SÍ la usa (genera las variantes que la ponen a prueba). Completo.
//   4. Veredictos (step4Prompt)          -> SÍ la usa (aplica la definición para decidir el veredicto). Completo.
//   5. Preguntas nuevas/Alcance (step5)  -> NO la usa (recibe el veredicto ya decidido como dato de entrada, nunca
//                                            lo re-deriva). PENDIENTE de recortar — no tiene compuerta de rechazo
//                                            que pueda fallar en silencio, así que el riesgo de posponerlo es bajo.
//   6. Relaciones (step6Prompt)          -> NO la usa (compara si dos explicaciones abordan el mismo problema, no
//                                            su calidad individual). PENDIENTE de recortar, mismo motivo que 5.
//   7. Reporte principal (step7Principal)-> SÍ la usa (traduce los veredictos a prosa para el usuario). Completo.
const CRITERIO_CENTRAL = `${CRITERIO_EXPLICACION}\n\n${REGLA_JERGA}\n\n${REGLA_IDIOMA}`.trim();

export function problemaRazonamientoPrompt(texto: string) {
  const system = `
${REGLA_JERGA}

${REGLA_IDIOMA}

Tu tarea en este paso es distinta y ANTERIOR a la de buscar explicaciones: antes de mirar ninguna frase con forma
de explicación, identifica el PROBLEMA o conflicto de ideas que el texto plantea — lo resuelva el texto o no.

Un problema genuino es la pregunta —explícita o implícita— a la que el texto, o una afirmación central de él, está
respondiendo. Cualquier afirmación central de un texto argumentativo puede leerse como la respuesta a alguna
pregunta que la vuelve necesaria: encuentra esa pregunta, exista o no una tensión visible en el tono del autor. No
es lo mismo que un tema (de qué habla el texto en general), ni que un principio metodológico o normativo enunciado
en abstracto (qué debería hacerse o creerse, en general) — la pregunta debe ser lo bastante concreta y específica
como para que una respuesta distinta de la que da el texto sea una alternativa genuina, no solo retórica.

La seguridad o el tono categórico con que el autor escribe no es evidencia de que no haya conflicto: puede afirmar
cada cosa con total seguridad y sin embargo estar describiendo una situación donde dos afirmaciones, o una
afirmación y un hecho reportado, no encajan del todo. No busques señales de que el autor DUDA o vacila — evalúa si
lo que describe, más allá de su tono, contiene esa tensión o incompatibilidad. Ejemplo (de un dominio distinto, para
mostrar que esto no es exclusivo de dictámenes legales): un artículo narra con total seguridad que una empresa
"redujo costos un 30% eliminando personal" y, párrafos después, con la misma seguridad, que "la productividad del
equipo restante se mantuvo intacta" — ninguna de las dos frases suena dudosa por sí sola, pero juntas plantean una
tensión genuina (¿cómo se sostiene la misma producción con menos gente, sin que se explique la diferencia?) que el
tono confiado del autor no resuelve ni debería ocultar.

Busca también dónde el autor se distingue explícitamente de una postura distinta a la suya, o se defiende de una
acusación o malentendido anticipado — esa distinción defensiva casi siempre revela un problema real debajo, incluso
cuando el autor la resuelve con total seguridad.

El formato retórico del texto es irrelevante para esta búsqueda: un conflicto genuino puede estar planteado en
prosa narrativa continua, pero igual de bien en un formato de preguntas y respuestas, un dictamen legal, una lista,
o cualquier otra estructura. No asumas que un texto organizado como FAQ o Q&A es meramente informativo o
descriptivo solo por su forma — evalúa el contenido, no el envoltorio. Presta atención especial a dos lugares
donde el formato puede esconder un conflicto real:
- El conflicto puede estar planteado en un párrafo introductorio (narrativo) que antecede a un cuerpo en
  preguntas y respuestas, y no repetirse explícitamente después — no lo descartes por no reaparecer en cada
  respuesta. Ejemplo: un texto abre narrando que una ley eliminó cierta figura legal, pero un documento reciente
  describe que esa misma figura fue otorgada de nuevo, y el propio autor llama a esto "inconsistencias jurídicas"
  — eso es un conflicto genuino (norma vs. hecho reportado) aunque el resto del texto sea una serie de preguntas
  puntuales que nunca vuelven a mencionarlo con esas palabras.
- El conflicto puede emerger de comparar dos respuestas o secciones separadas entre sí, no de una sola frase
  aislada. Ejemplo: una respuesta concluye "X es nulo SI se probara una agresión", y otra respuesta (sobre un tema
  aparentemente distinto) concluye "SI NO hubo agresión, entonces la justificación Y se cae por su propio peso" —
  ambas ramas no pueden ser ciertas a la vez de forma cómoda para el mismo texto, y eso es precisamente el tipo de
  incompatibilidad entre ideas que este paso debe capturar, aunque ninguna de las dos respuestas por separado
  parezca "plantear un conflicto".

Distingue dos niveles:
- "maestro": el conflicto que organiza al resto — si el texto tiene una pregunta central de la que las demás son
  variaciones o consecuencias, esa es la maestra. Puede venir planteada como principio metodológico en vez de como
  mecanismo causal explícito (ej. un texto que insiste en "hay que exigir explicaciones, no repetir consignas" está
  planteando, aunque no lo diga con esas palabras, el problema de por qué las consignas repetidas sustituyen a las
  explicaciones) — no lo pases por alto solo porque no está enunciado como pregunta causal directa. A lo sumo hay
  UN problema maestro por texto (puede no haber ninguno si el texto no tiene ningún hilo que organice al resto).
- "local": conflictos subsidiarios, más específicos o periféricos, que el texto también plantea (los resuelva o
  no) pero que no organizan al resto.

Busca también, de forma deliberada, problemas que el propio autor deja SIN resolver — silenciados, mencionados de
pasada, o dejados como pregunta abierta a propósito. Estos cuentan igual que los que sí llegan a tener una
explicación en el texto: en este paso NO estás buscando explicaciones, solo problemas.

Si el texto no plantea ningún conflicto genuino (ninguna tensión entre expectativa y observación, ninguna
incompatibilidad entre ideas), concluye eso — no fuerces un problema donde solo hay narración, opinión o
descripción de hechos sin tensión entre ellos. Esto es un resultado legítimo, no un fallo de este paso, pero debe
ser una conclusión razonada: qué candidatos concretos consideraste (citando o parafraseando el texto) y por qué
cada uno no calificó como problema genuino — nunca una afirmación vacía sin ese trabajo detrás.

Razona en prosa libre, con el detalle que haga falta, mostrando explícitamente qué candidatos consideraste y por
qué cada uno calificó o no. Termina tu respuesta con una sección exacta con este formato, sin texto adicional
después de ella:

PROBLEMAS ACEPTADOS:
MAESTRO: <enunciado del problema maestro, si lo hay>
LOCAL: <enunciado de un problema local>
LOCAL: <enunciado de otro problema local, si lo hay>

Si no aceptaste ningún problema, la sección debe decir exactamente:

PROBLEMAS ACEPTADOS:
(ninguno)
`.trim();

  const user = `Texto a analizar:\n\n${texto}`;

  return { system, user };
}

// Paso 2 de la detección de Problema: recibe el razonamiento ya escrito por problemaRazonamientoPrompt (llamada
// libre, sin tool_choice forzado) y solo lo estructura — no vuelve a juzgar si los problemas son genuinos. Separar
// "pensar" de "estructurar" evita que el modelo tome el atajo de relleno genérico bajo la presión de producir ya
// una respuesta con schema, visto en el Paso 1 incluso con tool_choice forzado + strict:true + una instrucción
// explícita prohibiendo el relleno, cuando pensar y estructurar competían en la misma llamada.
export function problemaEstructuraPrompt(razonamiento: string) {
  const system = `
${REGLA_IDIOMA}

Vas a recibir el razonamiento ya completo de un paso anterior, donde se analizó un texto para encontrar problemas
o conflictos genuinos. Tu única tarea es EXTRAER y estructurar los problemas que ese razonamiento aceptó — no
vuelvas a juzgar si son genuinos, no agregues problemas que el razonamiento no aceptó explícitamente, y no omitas
ninguno de los que sí aceptó. Busca la sección "PROBLEMAS ACEPTADOS:" al final del razonamiento y transcribe cada
línea a la estructura pedida. Si esa sección dice "(ninguno)", devuelve una lista vacía.
`.trim();

  const user = `Razonamiento ya completo:\n\n${razonamiento}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      problemas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tipo: {
              type: "string",
              enum: ["maestro", "local"],
              description: "A lo sumo un problema puede ser 'maestro' en todo el texto",
            },
            enunciado: {
              type: "string",
              description: "El problema formulado como pregunta o tensión concreta, evaluable",
            },
          },
          required: ["tipo", "enunciado"],
          additionalProperties: false,
        },
      },
    },
    required: ["problemas"],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "reportar_problemas",
    toolDescription: "Estructura los problemas ya aceptados en el razonamiento previo.",
    inputSchema,
  };
}

export function explicacionPrompt(texto: string, problemas: Problema[]) {
  const maestro = problemas.find((p) => p.tipo === "maestro");

  const chequeoDePuente = maestro
    ? `CHEQUEO DE PUENTE: esto aplica únicamente a explicaciones que respondan a un problema LOCAL, nunca al
problema maestro ("${maestro.enunciado}"). Cuando una explicación resuelve un problema local sin nunca argumentar
cómo se conecta con el problema maestro —lo asume, no lo explica—, márcala con puente.laguna=true y justifica en
una frase qué conexión se está asumiendo sin argumentar. Esta es una laguna distinta de que la explicación sea
"fácil de variar" o de que no tenga sustituto genuino: es, específicamente, un puente faltante entre lo local y lo
central. Si la explicación sí argumenta esa conexión, o si responde directamente al problema maestro (no aplica
el chequeo), marca puente.laguna=false con una justificación breve de por qué no aplica o por qué el puente sí
está argumentado.`
    : `Como no se identificó ningún problema maestro en el paso anterior, el chequeo de puente no aplica: deja
puente.laguna=false con justificación "No hay problema maestro identificado en este texto" en todas las
explicaciones.`;

  const system = `
${REGLA_JERGA}

${REGLA_IDIOMA}

En el paso anterior ya se identificó el conflicto que este texto plantea, sin mirar todavía ninguna explicación.
Ahora, y solo ahora, busca si el texto ofrece una EXPLICACIÓN genuina (un intento de responder "por qué ocurre X"
o "qué mecanismo produce X") para cada uno de los problemas ya formulados que se te entregan. No inventes una
explicación para un problema si el texto no la ofrece — que un problema quede sin ninguna explicación candidata es
un hallazgo legítimo de este paso, no un error: repórtalo simplemente sin candidatas asociadas a ese problema.

Distingue las explicaciones de:
- narración/descripción: relatar qué pasó o cómo son las cosas, sin proponer una causa o mecanismo.
- juicio normativo puro: afirmar qué debería pasar o qué es deseable/indeseable, sin explicar por qué ocurre algo.

Para cada explicación candidata, indica a cuál de los problemas entregados responde (problemaId, usando el id
exacto que se te dio), cita el fragmento exacto del texto, y resume la explicación en una frase. Además, distingue
explícitamente DOS niveles de la misma explicación, sin fusionarlos y sin omitir detalle de ninguno de los dos:

- mecanismoGeneral: el mecanismo UNIVERSAL que la explicación invoca — la regularidad que, en principio, operaría
  igual de bien más allá de este caso concreto, si las condiciones relevantes se repitieran en cualquier otro
  contexto. Enúncialo sin nombrar a los actores, países o hechos específicos de este texto (ej. no "el remanente
  chavista evita el escrutinio judicial", sino "un grupo cuya riqueza depende de que su origen no sea escrutado
  tiene un incentivo directo en bloquear las instituciones capaces de ese escrutinio"). Esto NO es pedir un
  resumen más corto o más vago del mismo resumen — es un enunciado distinto, al nivel del patrón general, tan
  completo y preciso en su propio nivel como el resumen lo es en el suyo.
- resumen: la aplicación específica de ese mecanismo general al caso concreto del texto (quién, qué, cuándo) — se
  mantiene igual de detallado que antes, como UNA INSTANCIA del mecanismo general, no como el mecanismo mismo.

${chequeoDePuente}

Para cada afirmación descartada por ser narración, descripción o juicio normativo puro, cita el fragmento y explica
brevemente por qué no cuenta como explicación.

Sé exhaustivo pero no inventes explicaciones que el texto no contiene.
`.trim();

  const user = `Texto a analizar:\n\n${texto}\n\nProblemas ya identificados (busca explicaciones para estos, y solo estos):\n${JSON.stringify(
    problemas.map((p) => ({ id: p.id, tipo: p.tipo, enunciado: p.enunciado })),
    null,
    2
  )}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      candidatas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            problemaId: { type: "string", description: "El id del problema (de la lista entregada) que esta explicación responde" },
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
            puente: {
              type: "object",
              properties: {
                laguna: { type: "boolean" },
                justificacion: { type: "string" },
              },
              required: ["laguna", "justificacion"],
            },
          },
          required: ["problemaId", "cita", "mecanismoGeneral", "resumen", "puente"],
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
    toolName: "reportar_explicaciones",
    toolDescription: "Reporta las explicaciones candidatas (ligadas a los problemas ya identificados, con chequeo de puente) y las afirmaciones descartadas.",
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

export type IdentificacionVariante = {
  tipo: "actor_con_motivo" | "cadena_causal" | "hibrido";
  elementoFijo: string;
  ingredienteVariable: string;
  dominio: string;
};

// Paso 1 de 2 en la generación de variantes: solo identifica qué es fijo y cuál es el "ingrediente variable" —
// no genera ningún sustituto todavía. Mezclar "identificar qué varía" con "ya generar un reemplazo" en la misma
// llamada producía sistemáticamente sustituciones que cambiaban de dominio, de tipo de explicación o de sujeto,
// en vez de sustituciones mínimas genuinas (confirmado empíricamente: explicaciones de tipo cadena causal
// generaban 0 variantes válidas de 3 intentos, todas autodescartadas por exactamente estos tres errores).
export function step3IdentificarPrompt(texto: string, explicacion: Explicacion, problema: Problema) {
  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso es SOLO identificar, con precisión, qué parte de esta explicación debe quedar fija y cuál
es el "ingrediente variable" — el detalle concreto que un paso posterior va a intentar sustituir. No generes
ningún sustituto todavía; eso es trabajo exclusivo del paso siguiente.

Primero, identifica de qué TIPO es esta explicación:

- ACTOR-CON-MOTIVO: un sujeto (nombrado o descrito en abstracto — da igual, ej. "el gobierno X" o "un grupo que
  teme rendir cuentas") hace o decide algo POR UN MOTIVO. El SUJETO es el elemento fijo. El ingrediente variable
  es el motivo o razón específica que se le atribuye.
- CADENA CAUSAL: no hay ningún sujeto que decida nada — un factor concreto produce un efecto a través de una
  cadena impersonal (ej. "la ilegitimidad institucional genera incertidumbre, y esa incertidumbre desalienta la
  inversión de largo plazo"). La CADENA que conecta causa y efecto (ej. "esa incertidumbre desalienta la
  inversión de largo plazo") es el elemento fijo. El ingrediente variable es el factor causal concreto que
  dispara esa cadena (ej. "ilegitimidad institucional").
- HÍBRIDO: un actor cuya decisión desencadena, a su vez, una cadena causal impersonal — identifica cuál de los
  dos eslabones es el que la explicación realmente pone en juego antes de clasificar, y trátalo como el tipo
  correspondiente (actor-con-motivo o cadena causal) para el resto de este paso.

Luego, extrae el ingrediente variable tal como aparece en la explicación (cítalo o parafraséalo muy de cerca —
no lo generalices ni lo abstraigas todavía), y nombra su DOMINIO: la categoría concreta a la que pertenece (ej.
"características institucionales de gobernanza", "incentivo financiero personal", "riesgo regulatorio"). Ese
dominio es el límite que usará el paso siguiente — los sustitutos que proponga deben quedarse dentro de él.

Usa mecanismoGeneral (la versión abstracta que ya se extrajo en el Paso 2, sin actores ni hechos específicos de
este texto) como ayuda para separar lo fijo de lo variable: resumen es la instancia concreta, mecanismoGeneral ya
muestra el patrón general del que el ingrediente variable es un caso particular.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { id: explicacion.id, cita: explicacion.cita, resumen: explicacion.resumen, mecanismoGeneral: explicacion.mecanismoGeneral },
    null,
    2
  )}\n\nProblema que pretende resolver:\n${problema.enunciado}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["actor_con_motivo", "cadena_causal", "hibrido"],
      },
      elementoFijo: {
        type: "string",
        description: "El sujeto (actor-con-motivo) o la cadena/mecanismo completo (cadena causal) que debe permanecer igual en toda variante",
      },
      ingredienteVariable: {
        type: "string",
        description: "El detalle concreto específico —tal como aparece en la explicación— que sí se puede sustituir",
      },
      dominio: {
        type: "string",
        description: "La categoría o campo al que pertenece el ingrediente variable, que limita qué sustitutos son válidos",
      },
    },
    required: ["tipo", "elementoFijo", "ingredienteVariable", "dominio"],
  };

  return {
    system,
    user,
    toolName: "reportar_identificacion",
    toolDescription: "Identifica el elemento fijo y el ingrediente variable de esta explicación, sin generar todavía ningún sustituto.",
    inputSchema,
  };
}

// Paso 2 de 2: recibe la identificación ya hecha (sin volver a juzgar tipo/elemento fijo) y solo propone valores
// alternativos para el ingrediente ya nombrado — una tarea mucho más angosta y mecánica que "identifica y genera
// a la vez", que es donde el modelo derrapaba hacia reescrituras estructurales.
export function step3VariantesPrompt(
  texto: string,
  explicacion: Explicacion,
  problema: Problema,
  identificacion: IdentificacionVariante
) {
  const system = `
${CRITERIO_CENTRAL}

En el paso anterior ya se identificó, para esta explicación:
- Tipo: ${identificacion.tipo}
- Elemento fijo (debe permanecer igual en toda variante, palabra por palabra si hace falta): "${identificacion.elementoFijo}"
- Ingrediente variable (el único detalle que puedes sustituir): "${identificacion.ingredienteVariable}"
- Dominio (los sustitutos deben quedarse dentro de esta categoría, nunca saltar a otra): "${identificacion.dominio}"

Tu tarea ahora: proponer 2 o 3 valores ALTERNATIVOS para el ingrediente variable, dentro del mismo dominio, y
para cada uno construir la descripción completa de la variante — la explicación original con el ingrediente
variable reemplazado por el nuevo valor, dejando el elemento fijo y todo lo demás literalmente igual.

Ya no tienes que descubrir qué varía — eso ya se hizo en el paso anterior. Tu único trabajo es de generación
dentro de un dominio ya delimitado, y encontrar varios miembros de una misma categoría casi siempre es posible:
si el dominio es "características institucionales de gobernanza", otros miembros obvios incluyen informalidad
administrativa, discrecionalidad regulatoria, opacidad presupuestaria, debilidad del sistema judicial, etc. — no
hace falta que sean creativos o insólitos, solo que sean genuinamente distintos entre sí y pertenezcan al mismo
dominio.

PRIMER PASO OBLIGATORIO: antes de construir ninguna descripción de variante, llena candidatosBrutos con al menos
4 o 5 valores CRUDOS — sustantivos o frases cortas (ej. "informalidad administrativa", "discrecionalidad
regulatoria"), NO oraciones completas ni descripciones de variante — que consideres como posible reemplazo del
ingrediente variable, dentro del dominio indicado. Escribe esta lista antes de evaluar cuáles califican; es tu
espacio para pensar en voz alta, no el resultado final.

SEGUNDO PASO: para cada valor de candidatosBrutos, evalúa si de verdad pertenece al dominio y mantiene intacto el
elemento fijo al sustituirlo. Los que sí califiquen, constrúyelos como una descripción completa de variante en
variantesAceptadas con tipo "sustitucion_minima" (máximo 2-3, elige los mejores si sobran). Los que no, repórtalos
en variantesDescartadas explicando cuál de los tres errores de abajo cometieron — no los omitas silenciosamente.

Ejemplos de sustitución mínima VÁLIDA (ingrediente original → alternativa, mismo dominio, mismo elemento fijo):
- [cadena causal] elemento fijo "esa incertidumbre desalienta la inversión de largo plazo", ingrediente
  "ilegitimidad institucional" → alternativa "informalidad administrativa" (mismo dominio: características
  institucionales de gobernanza). Variante resultante: "la informalidad administrativa genera incertidumbre que
  desalienta la inversión de largo plazo".
- [cadena causal] elemento fijo "limita la construcción, lo cual reduce la oferta y sube los precios",
  ingrediente "restricciones de zonificación" → alternativa "impuestos prediales elevados a la construcción
  nueva" (mismo dominio: política regulatoria de vivienda).
- [actor-con-motivo] elemento fijo "el remanente chavista cede recursos con tal de...", ingrediente "evitar el
  costo de su ilegitimidad" → alternativa "asegurar impunidad penal para sus líderes" (mismo dominio:
  auto-preservación frente a la rendición de cuentas).
- [actor-con-motivo] elemento fijo "el gerente aprueba el proyecto riesgoso porque quiere...", ingrediente
  "cumplir la meta trimestral de ventas" → alternativa "asegurar su bono anual" (mismo dominio: incentivo
  financiero personal).

Antes de aceptar cada propuesta como válida, verifica que el valor alternativo sí pertenezca al dominio indicado
y que la variante resultante mantenga intacto el elemento fijo. Si al proponer un valor notas que en realidad se
sale del dominio, cambia el elemento fijo, o convierte esto en un tipo de explicación distinto, repórtalo en
variantesDescartadas explicando cuál de estos tres errores cometió — sigue siendo información valiosa, aunque el
paso anterior ya haya fijado qué ingrediente sustituir:
- Cambio de DOMINIO (la alternativa pertenece a una categoría distinta a la indicada).
- Cambio de TIPO de explicación (convierte una cadena causal impersonal en un motivo de un actor, o viceversa).
- Cambio de ELEMENTO FIJO (el sujeto, o la cadena/mecanismo, terminó siendo distinto al indicado).

Si la explicación hace una afirmación sobre el futuro, o extrapola hacia adelante una tendencia actual, genera
SIEMPRE una variante adicional (más allá de las 2 o 3 de tipo "sustitucion_minima") con tipo "conocimiento_nuevo":
un escenario donde surge conocimiento nuevo —una innovación, un cambio de política, un desarrollo imprevisto— que
altera la trayectoria que la explicación asume. Descríbela con suficiente detalle concreto (qué tipo de
desarrollo, cómo altera la trayectoria) para que sea evaluable como las demás. Va en variantesAceptadas (no la
descartes por "ser complementaria": existe específicamente para poner a prueba si la explicación deja espacio
para que algo así ocurra) — pero prueba algo distinto de una sustitución de dominio, así que el paso siguiente la
evaluará y reportará por separado del veredicto principal. Es la única variante que puede llevar tipo
"conocimiento_nuevo"; nunca la confundas con una sustitución mínima ni generes más de una por explicación.

Devolver variantesAceptadas Y variantesDescartadas ambas vacías debería ser un resultado raro, reservado para
cuando el dominio indicado es genuinamente tan estrecho que no admite ningún otro miembro genuino (esto es
distinto de "no se me ocurre nada ahora mismo" — vuelve a intentar la enumeración de candidatos antes de
concluir esto). No fuerces una variante artificial ni la disfraces cambiando lo que debía quedarse fijo solo para
no dejar la lista vacía — pero tampoco declares vacío sin haber enumerado activamente varios candidatos primero.

Reporta las variantes aceptadas (sustitutos genuinos) por separado de las descartadas, con su motivo de descarte.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { id: explicacion.id, cita: explicacion.cita, resumen: explicacion.resumen, mecanismoGeneral: explicacion.mecanismoGeneral },
    null,
    2
  )}\n\nProblema que pretende resolver:\n${problema.enunciado}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      candidatosBrutos: {
        type: "array",
        description: "PRIMER PASO: al menos 4-5 valores crudos (sustantivos o frases cortas, no oraciones completas) que consideraste para el ingrediente variable, antes de vetar cuáles califican.",
        items: { type: "string" },
      },
      variantesAceptadas: {
        type: "array",
        maxItems: 4,
        description: "Puede quedar vacío si genuinamente no se encontró ningún sustituto genuino — no se debe forzar una entrada aquí solo para no dejarlo vacío.",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción de la variante (sustituto genuino), no vacía" },
            tipo: {
              type: "string",
              enum: ["sustitucion_minima", "conocimiento_nuevo"],
              description: "'conocimiento_nuevo' solo para la variante especial de desarrollo futuro/imprevisto, si aplica — a lo sumo una por explicación",
            },
          },
          required: ["descripcion", "tipo"],
        },
      },
      variantesDescartadas: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string" },
            motivo: { type: "string", description: "Por qué se descarta (ej. cambio de dominio, de tipo, o de elemento fijo)" },
          },
          required: ["descripcion", "motivo"],
        },
      },
    },
    required: ["candidatosBrutos", "variantesAceptadas", "variantesDescartadas"],
  };

  return {
    system,
    user,
    toolName: "reportar_variantes",
    toolDescription: "Reporta las variantes aceptadas y descartadas, sustituyendo solo el ingrediente variable ya identificado.",
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
resolverlo ("rompe" → la explicación es difícil de variar en ese aspecto, señal de fuerza). Evalúa TODAS las
variantes que recibas, sin importar su tipo, y reporta el resultado de cada una en resultadosVariantes.

Las variantes vienen marcadas con un tipo, y eso decide qué cuenta para qué:
- "sustitucion_minima": prueban si un detalle concreto dentro del mismo dominio es intercambiable. SOLO estas
  cuentan para el veredicto principal.
- "conocimiento_nuevo": prueba algo cualitativamente distinto — si la aparición de información, una innovación o
  un desarrollo imprevisto (no una sustitución de dominio) cambiaría la trayectoria que la explicación asume.
  NUNCA la mezcles con las de sustitución mínima al calcular el veredicto principal — se reporta aparte, en su
  propio campo.

Con base ÚNICAMENTE en el patrón de resultados de las variantes de tipo "sustitucion_minima" (ignora por completo
cualquier "conocimiento_nuevo" para este cálculo), da un veredicto PRINCIPAL para la explicación:
- "DificilDeVariar": la mayoría o todas las variantes de sustitución mínima rompen (la explicación es fuerte).
- "FacilDeVariar": la mayoría o todas las variantes de sustitución mínima sobreviven (la explicación es débil).
- "Mixta": resultados mezclados entre las variantes de sustitución mínima, sin un patrón claro.

Justifica el veredicto principal con una frase que sintetice el patrón observado entre las variantes de
sustitución mínima — SIN mencionar el resultado de la variante de conocimiento nuevo ahí; es una señal aparte,
nunca evidencia para este veredicto.

Si entre las variantes recibidas hay una de tipo "conocimiento_nuevo", repórtala también, aparte, en
resisteConocimientoNuevo: su propio resultado (rompe/sobrevive, con el mismo criterio de arriba) y su
justificación. Si no recibiste ninguna variante de ese tipo, omite el campo resisteConocimientoNuevo por completo.
`.trim();

  const user = `Texto original (para contexto):\n\n${texto}\n\nExplicación:\n${JSON.stringify(
    { id: explicacion.id, resumen: explicacion.resumen },
    null,
    2
  )}\n\nProblema:\n${problema.enunciado}\n\nVariantes a evaluar:\n${JSON.stringify(
    variantes.map((v) => ({ id: v.id, descripcion: v.descripcion, tipo: v.tipo })),
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
      veredicto: {
        type: "string",
        enum: ["DificilDeVariar", "FacilDeVariar", "Mixta"],
        description: "Calculado SOLO sobre las variantes de tipo sustitucion_minima",
      },
      justificacion: { type: "string" },
      resisteConocimientoNuevo: {
        type: "object",
        description: "Solo si evaluaste una variante de tipo conocimiento_nuevo; omite este campo por completo si no recibiste ninguna.",
        properties: {
          resultado: { type: "string", enum: ["rompe", "sobrevive"] },
          justificacion: { type: "string" },
        },
        required: ["resultado", "justificacion"],
      },
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

Cada explicación trae su problemaId. Si dos explicaciones comparten el mismo problemaId, ESO YA CONFIRMA que
abordan el mismo problema — no lo vuelvas a evaluar comparando el texto de resumen entre sí, y nunca las
descartes como "no comparables" por tratar aspectos superficialmente distintos del mismo asunto. Para ese par, la
única pregunta que queda es si compiten entre sí ("compite_con") o si, pese a resolver el mismo problema, lo
hacen de forma compatible y pueden convivir sin contradecirse ("complementa") — nunca la ausencia de relación.

Solo cuando dos explicaciones tengan problemaId DISTINTOS evalúa por contenido si sus problemas son, en el fondo,
iguales o muy cercanos pese a tener IDs distintos (puede pasar si el Paso 1 los separó como locales distintos
pero en realidad se solapan). Si sus problemas son genuinamente distintos, no fuerces ninguna relación entre ellas.
`.trim();

  const user = `Explicaciones y sus problemas:\n${JSON.stringify(
    explicaciones.map((e) => ({
      id: e.id,
      problemaId: e.problemaId,
      resumen: e.resumen,
      problema: problemas.find((p) => p.id === e.problemaId)?.enunciado,
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
- El veredicto principal (DificilDeVariar/FacilDeVariar/Mixta) y la señal de resisteConocimientoNuevo son DOS
  observaciones distintas sobre la misma explicación — nunca las fusiones en una sola frase de causa-efecto (ej.
  nunca digas que la explicación "es Mixta porque no resistió el conocimiento nuevo": esa variante nunca cuenta
  para el veredicto principal, así que no es su causa). Narra el veredicto principal primero, con su propia
  justificación. Si además hay un dato en resisteConocimientoNuevo (puede no haberlo — la explicación no siempre
  hace una afirmación sobre el futuro), añádelo como una observación aparte, con su propia justificación: si
  resultado es "rompe", algo como "esta explicación, además, no deja espacio para que conocimiento futuro cambie
  la trayectoria que asume"; si es "sobrevive", algo como "esta explicación sí deja espacio para que un desarrollo
  futuro imprevisto altere lo que asume, sin que eso la debilite". Nunca uses las palabras "predicción" ni
  "profecía" para ninguna de las dos.
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
- Si una explicación tiene una laguna de puente (puenteLaguna=true), señálalo en prosa como su propio tipo de
  debilidad, distinto de ser fácil de variar o de no tener sustituto genuino: esta explicación resuelve un
  problema local dando por sentado, sin argumentarlo, cómo se conecta con el conflicto central del texto. Usa la
  justificación entregada para nombrar qué conexión se asume sin argumentar (ej. "el texto asume, sin explicarlo,
  que resolver esto también resuelve..."). Esto aplica incluso a explicaciones con veredicto fuerte: sobrevivir el
  cambio de sus propios detalles no repara un puente que nunca se argumentó.
- Si hay problemas que el texto plantea pero para los que no se ofrece ninguna explicación (ver
  "problemasSinExplicacion" en los datos), menciónalos en prosa como preguntas que el texto deja abiertas o sin
  resolver, en una sección o párrafo propio. Trátalo como un hallazgo legítimo sobre el texto, no como un defecto
  de este análisis — puede ser una omisión notable o una pregunta que el propio autor deja deliberadamente sin
  responder.

No incluyas los datos crudos (IDs, listas estructuradas) en el reporte: tradúcelos a prosa legible.

IMPORTANTE: NO escribas ninguna conclusión general, cierre ni valoración global de la calidad del texto completo
— eso lo redacta otro paso por separado, que también incorpora los hallazgos de persuasión y necesita ser la
única conclusión del reporte final. Termina tu redacción justo después de cubrir la última explicación o
relación entre explicaciones, sin resumir ni cerrar.
`.trim();

  const problemasSinExplicacion = problemas
    .filter((p) => !explicaciones.some((e) => e.problemaId === p.id))
    .map((p) => p.enunciado);

  const user = `Texto original:\n\n${texto}\n\nDatos del análisis (uso interno, tradúcelos a prosa):\n${JSON.stringify(
    {
      explicaciones: explicaciones.map((e) => ({
        id: e.id,
        resumen: e.resumen,
        cita: e.cita,
        problema: problemas.find((p) => p.id === e.problemaId)?.enunciado,
        puenteLaguna: e.puente?.laguna ?? false,
        puenteJustificacion: e.puente?.justificacion ?? "",
        veredicto: veredictos.find((v) => v.explicacionId === e.id),
        problemasNuevos: problemasNuevosPorExplicacion.get(e.id) ?? [],
        alcance: alcances.find((a) => a.explicacionId === e.id),
      })),
      relaciones,
      problemasSinExplicacion,
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
