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

CHEQUEO DE IMAGEN CENTRAL: compara mecanismoGeneral (la versión despojada, sin actores ni imágenes) contra resumen
(la aplicación específica) que ya escribiste para esta misma explicación. Pregúntate: ¿resumen le añade una imagen
o analogía concreta que carga una connotación (moral, emocional, de indignidad, de peligro) que mecanismoGeneral,
leído solo, no sostiene por su cuenta? Si sí, marca imagenCentral.presente=true, nombra la imagen en
imagenCentral.imagen, y en connotacionAñadida di en una frase qué carga añade la imagen que el mecanismo desnudo
no aporta. Esto no es "esta explicación usa una metáfora" en general — es específicamente cuando esa imagen es el
ARMAZÓN de la explicación (varias explicaciones dependen de ella), no un adorno de estilo aislado.

Distinción importante: una figura retórica o expresión idiomática vívida NO cuenta como imagen central por sí
sola, aunque sea evocadora — solo cuenta cuando trae consigo un DOMINIO COMPLETO, con su propia lógica interna y
connotaciones que el lector importa desde fuera del texto. "Mascota" trae el dominio entero de la relación
dueño-mascota (dependencia, docilidad exigida, indignidad, cuidado condicionado). "Los oligarcas rusos" trae el
dominio del colapso postsoviético (captura del Estado, fatalismo histórico, ilegitimidad moral). En cambio, "el
elefante en la habitación" es una frase idiomática que señala algo obvio y no dicho, pero no importa un dominio
propio con su propia lógica — es una forma vívida de decir "algo evidente que nadie menciona", no una analogía
estructural. Si la imagen candidata es del segundo tipo (vívida pero sin dominio propio), marca
imagenCentral.presente=false.

Si resumen es simplemente la instancia concreta de mecanismoGeneral sin ninguna imagen que añada peso connotativo
propio (o si lo único que hay es una expresión idiomática sin dominio propio, como en el ejemplo de arriba), marca
imagenCentral.presente=false con imagen y connotacionAñadida en null.

CHEQUEO DE PREMISA DE VALOR OCULTA: distinto del chequeo de puente (que mira la conexión entre esta explicación y
el problema maestro). Este mira hacia ADENTRO de la explicación misma: ¿el mecanismo mezcla una afirmación
estructural/causal (algo que puede verificarse: existe tal dependencia, tal condición) con un juicio de valor no
argumentado sobre CÓMO SE EXPERIMENTARÍA esa estructura (ej. "esa dependencia se vive como malestar", "esa
condición es indigna"), presentado como si fuera parte del mismo hecho en vez de una afirmación aparte que
necesita su propia defensa? Si sí, marca premisaValorOculta.presente=true y en justificacion nombra exactamente
cuál es la afirmación estructural y cuál el juicio de valor que se le pegó sin argumentar. Si el mecanismo es
puramente estructural, o si la parte evaluativa sí está argumentada con sus propias razones (no solo asumida),
marcá premisaValorOculta.presente=false con justificacion en null.

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
            imagenCentral: {
              type: "object",
              description:
                "Compara mecanismoGeneral (despojado) contra resumen (aplicación específica): ¿resumen añade una imagen/analogía que carga peso connotativo que el mecanismo desnudo no sostiene?",
              properties: {
                presente: { type: "boolean" },
                imagen: { type: ["string", "null"], description: "La imagen/analogía concreta, o null si presente=false" },
                connotacionAñadida: { type: ["string", "null"], description: "Qué carga añade la imagen que el mecanismo desnudo no aporta, o null si presente=false" },
              },
              required: ["presente", "imagen", "connotacionAñadida"],
            },
            premisaValorOculta: {
              type: "object",
              description:
                "¿El mecanismo mezcla una afirmación estructural con un juicio de valor no argumentado sobre cómo se experimentaría esa estructura?",
              properties: {
                presente: { type: "boolean" },
                justificacion: { type: ["string", "null"], description: "Cuál es la afirmación estructural y cuál el juicio de valor pegado sin argumentar, o null si presente=false" },
              },
              required: ["presente", "justificacion"],
            },
          },
          required: ["problemaId", "cita", "mecanismoGeneral", "resumen", "puente", "imagenCentral", "premisaValorOculta"],
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
variantesDescartadas explicando cuál de estos cuatro errores cometió — sigue siendo información valiosa, aunque el
paso anterior ya haya fijado qué ingrediente sustituir:
- Cambio de DOMINIO (la alternativa pertenece a una categoría distinta a la indicada).
- Cambio de TIPO de explicación (convierte una cadena causal impersonal en un motivo de un actor, o viceversa).
- Cambio de ELEMENTO FIJO (el sujeto, o la cadena/mecanismo, terminó siendo distinto al indicado).
- Cambio de ELEMENTO FIJO por CONFLACIÓN CONCEPTUAL: el más difícil de notar, porque la alternativa suena del
  mismo campo semántico que el original y por eso parece una sustitución mínima cuando en realidad cambió de
  mecanismo. El test es de INDEPENDENCIA LÓGICA: pregúntate si la amenaza/motivo de la variante podría ser
  verdadera mientras la amenaza/motivo ORIGINAL es falsa, o viceversa. Si la respuesta es sí, no es el mismo
  elemento fijo, aunque ambos pertenezcan a la misma categoría general. Ejemplo real de este error: una
  explicación dice que una élite bloquea la democratización porque teme que se escrutine la PROCEDENCIA/
  legitimidad de su riqueza; una variante propone en cambio que la élite teme la EXPROPIACIÓN del activo. Ambos
  son "autoprotección económica" (mismo campo semántico), pero son lógicamente independientes: se puede temer la
  expropiación de una riqueza perfectamente legítima, y se puede temer el escrutinio del origen sin ningún riesgo
  de expropiación. Eso no es sustitución mínima — es cambio de elemento fijo disfrazado.

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
            // Obligatorio para forzar el chequeo real, no solo declarado en prosa (ver el error de conflación
            // conceptual arriba) — mismo tipo de scaffolding obligatorio que candidatosBrutos.
            elementoFijoVerificado: {
              type: "string",
              description:
                "En una frase: el elemento fijo PRECISO (no la categoría general) que esta variante preserva, y por qué el motivo/mecanismo original y el de esta variante no son lógicamente independientes entre sí — si uno podría ser verdadero sin el otro, esta variante no calificaba como sustitución mínima.",
            },
          },
          required: ["descripcion", "tipo", "elementoFijoVerificado"],
        },
      },
      variantesDescartadas: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string" },
            motivo: { type: "string", description: "Por qué se descarta (ej. cambio de dominio, de tipo, de elemento fijo, o conflación conceptual — cita el test de independencia lógica si aplica)" },
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

// Pares de explicaciones que comparten problemaId — compartir problemaId ya confirma que abordan el mismo
// problema, así que para estos pares "no comparable" no es una respuesta válida (ver step6Prompt). Exportada
// para que route.ts recorra exactamente los mismos pares al leer de vuelta las claves del schema.
//
// TODO (no urgente, anotado para más adelante): el número de pares obligatorios crece combinatorio con la
// cantidad de explicaciones que comparten un mismo problemaId (C(n,2) — 5 explicaciones sobre el mismo problema
// = 10 pares forzados, cada uno una clave de schema separada). No es un problema hoy con los volúmenes actuales,
// pero si en algún texto futuro muchas explicaciones terminan bajo el mismo problemaId, esto infla el tamaño del
// schema y el costo/latencia de la llamada de forma no lineal. Si se vuelve real, la salida más simple es un
// límite superior de pares obligatorios por problemaId (ej. degradar a instrucción reforzada en vez de clave de
// schema por par a partir de cierto n), no rehacer el mecanismo entero.
export function paresMismoProblema(explicaciones: Explicacion[]): [Explicacion, Explicacion][] {
  const pares: [Explicacion, Explicacion][] = [];
  for (let i = 0; i < explicaciones.length; i++) {
    for (let j = i + 1; j < explicaciones.length; j++) {
      if (explicaciones[i].problemaId === explicaciones[j].problemaId) {
        pares.push([explicaciones[i], explicaciones[j]]);
      }
    }
  }
  return pares;
}

export function claveRelacionMismoProblema(aId: string, bId: string): string {
  return `relacion_${aId}_${bId}`;
}

export function step6Prompt(explicaciones: Explicacion[], problemas: Problema[]) {
  const pares = paresMismoProblema(explicaciones);

  const system = `
${CRITERIO_CENTRAL}

Tu tarea en este paso tiene dos partes, con el MISMO nivel de exigencia en ambas:

1) PARES OBLIGATORIOS (mismo problemaId). Cada explicación trae su problemaId. Si dos explicaciones comparten el
mismo problemaId, ESO YA CONFIRMA que abordan el mismo problema — no lo vuelvas a evaluar comparando el resumen
de texto entre sí. Para cada uno de estos pares, "no comparable" NO es una opción válida bajo ninguna
circunstancia: tu única decisión es si compiten entre sí por resolver ese problema ("compite_con", son
sustitutas/rivales genuinas) o si, pese a resolver el mismo problema, lo hacen de forma compatible y pueden
convivir sin contradecirse ("complementa"). Esto se cumple incluso si a primera vista los resúmenes tratan
aspectos superficialmente distintos del mismo asunto — no lo tomes como señal de que "no comparan". La
justificación de cada par debe ser sustantiva y específica del contenido real de esas dos explicaciones — nunca
una frase de relleno genérica que serviría igual para cualquier otro par (el mismo cuidado que ya exigimos en el
Paso 3 al generar variantes: "obligatorio" nunca puede traducirse en "obligatorio pero vacío de contenido").

2) RELACIONES ADICIONALES (problemaId distintos) — esta parte NO es secundaria frente a la anterior, es igual de
importante. Cuando dos explicaciones tengan problemaId DISTINTOS, evalúa por contenido si sus problemas son, en
el fondo, iguales o muy cercanos pese a tener IDs distintos: esto pasa cuando el Paso 1 los separó como
problemas locales distintos pero en realidad se solapan o compiten de verdad. Es exactamente el tipo de relación
que esta parte del paso existe para detectar — no la trates como un caso raro ni como relleno opcional. Repórtala
en "relacionesAdicionales" con el mismo rigor y la misma justificación sustantiva que en la parte 1. Solo si,
tras evaluar el contenido, los problemas son genuinamente distintos y no hay relación real entre las
explicaciones, no fuerces nada ahí.
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
  )}${
    pares.length > 0
      ? `\n\nPares que comparten problemaId — debes clasificar CADA UNO de estos, sin excepción, con "compite_con" o "complementa" (nunca "no comparable"):\n${pares
          .map(([a, b]) => `- ${a.id} y ${b.id} (ambas resuelven ${a.problemaId})`)
          .join("\n")}`
      : "\n\nNinguna explicación de esta lista comparte problemaId con otra."
  }`;

  const relacionMismoProblemaSchema = {
    type: "object",
    properties: {
      tipo: { type: "string", enum: ["compite_con", "complementa"] },
      justificacion: {
        type: "string",
        description:
          "Sustantiva y específica del contenido real de ambas explicaciones — nunca una frase de relleno genérica.",
      },
    },
    required: ["tipo", "justificacion"],
  };

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [a, b] of pares) {
    properties[claveRelacionMismoProblema(a.id, b.id)] = relacionMismoProblemaSchema;
    required.push(claveRelacionMismoProblema(a.id, b.id));
  }

  properties.relacionesAdicionales = {
    type: "array",
    description:
      "Relaciones genuinas entre explicaciones con problemaId DISTINTOS que en el fondo resuelven el mismo problema o uno muy cercano. Mismo nivel de exigencia que los pares obligatorios: repórtalas cuando sean reales, no las trates como secundarias.",
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
  };
  required.push("relacionesAdicionales");

  const inputSchema: Schema = { type: "object", properties, required };

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
  técnico del método. Usa lenguaje llano: "no encontramos, entre las variantes que consideramos, ninguna que
  debilitara esta explicación...", "esta explicación podría reemplazar sus causas propuestas por otras y seguiría
  sonando igual de convincente, lo cual sugiere que no está realmente conectada con lo que dice explicar...".
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
- Si el veredicto principal es "DificilDeVariar", no lo presentes como una conclusión definitiva o cerrada: ancla
  la afirmación al alcance real de lo que se puso a prueba. Dilo en términos de "no encontramos, entre las
  variantes que consideramos, ninguna que la debilitara" en vez de "esta explicación resiste el cambio de sus
  detalles" sin más — la segunda formulación suena a un hecho establecido, mientras que la primera refleja
  honestamente que se trata de evidencia a favor tras un número limitado de intentos (2-3 sustituciones
  probadas), no de una prueba exhaustiva. Esto no le resta valor al veredicto — sigue siendo la explicación más
  sólida del texto frente a lo que sí se le puso a prueba — pero el lector debe entender que es evidencia
  acumulada bajo un número acotado de intentos, no una certeza cerrada.
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
- Si una explicación tiene imagenCentral.presente=true Y su veredicto principal es "FacilDeVariar", agrega una nota
  de contexto honesta (no una excusa): la fuerza persuasiva de esta explicación probablemente vive en la resonancia
  de la imagen elegida (usa el dato de "imagen"), no en la necesidad lógica del detalle concreto — nombra el
  mecanismo con precisión, como ya haces al distinguir ingenio de sarcasmo en la sección de persuasión, en vez de
  quedarte solo con el veredicto seco. Usa el dato de "connotacionAñadida" para decir qué carga trae esa imagen que
  el mecanismo, despojado de ella, no sostendría por sí solo.
- Si una explicación tiene premisaValorOculta.presente=true, señálalo como su propia observación (puede convivir
  con la nota de imagenCentral en la misma explicación — son dos hallazgos que se acumulan, nunca uno reemplaza al
  otro): usa la justificación entregada para nombrar, en una frase, cuál es la afirmación estructural y cuál el
  juicio de valor que se le pegó sin argumentar, en el espíritu de "esta explicación mezcla una afirmación sobre la
  estructura con un juicio de valor no argumentado sobre cómo se experimentaría esa estructura — asume que [la
  afirmación de valor], sin dar razones de por qué sería así y no de otra manera."
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
        imagenCentral: e.imagenCentral ?? { presente: false, imagen: null, connotacionAñadida: null },
        premisaValorOculta: e.premisaValorOculta ?? { presente: false, justificacion: null },
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

export type AnalisisParaComparar = {
  metaTitulo: string;
  metaAutor: string;
  reporte: string;
  tripletas: string;
};

export function comparacionPrompt(analisisA: AnalisisParaComparar, analisisB: AnalisisParaComparar) {
  const system = `
${REGLA_JERGA}

${REGLA_IDIOMA}

Vas a comparar dos análisis críticos YA TERMINADOS de dos textos de opinión distintos (no el texto crudo: cada
análisis ya incluye su reporte final y una representación estructurada de sus problemas, explicaciones, variantes,
veredictos y relaciones). Tu tarea tiene un límite estricto: comparas ESTRUCTURA y RIGOR ARGUMENTATIVO, nunca cuál
de las dos descripciones se acerca más a la realidad. Esa segunda pregunta no es tuya para responder — ni de forma
directa, ni insinuada en el tono de la síntesis, ni "colándola" como si fuera una consecuencia natural de comparar
el rigor. Dos análisis pueden ser igual de rigurosos aunque defiendan posiciones opuestas, y uno puede ser más
riguroso que el otro sin que eso diga nada sobre cuál tiene razón.

Tu tarea tiene tres partes independientes, cada una con su propio campo de respuesta — no fusiones ninguna con
otra:

1) ¿Resuelven el mismo problema o problemas distintos? Compara los problemas centrales que cada análisis identificó
(ver "problemas" en la sección de tripletas de cada uno) y decide si, en el fondo, están respondiendo la misma
pregunta o preguntas genuinamente distintas — incluso si los textos originales tratan temas superficialmente
distintos, o incluso si tratan el mismo tema pero desde ángulos que en realidad no compiten. La justificación tiene
que ser sustantiva y específica de ambos análisis, nunca una frase genérica que serviría para cualquier otro par.

2) Firmeza del puente hacia la conclusión de CADA análisis, evaluada de forma independiente (no comparativa entre
sí): ¿la cadena de razonamiento de ese análisis — desde lo que el texto original argumenta hasta la conclusión que
el reporte sostiene — está bien tendida, o tiene saltos, lagunas o veredictos débiles (explicaciones fáciles de
variar, sin sustituto genuino evaluado, etc.) que la debilitan? Esto se evalúa una vez por cada análisis, cada uno
con su propia justificación sustantiva basada en lo que ese reporte y esas tripletas realmente muestran — nunca
copies o parafrasees la justificación de un análisis para el otro.

3) Síntesis final: un párrafo breve que resume la comparación estructural (mismo problema o no, firmeza relativa
de cada puente) en prosa ordinaria para el usuario final. Puede señalar que un puente es más firme que otro sin
que eso se traduzca en ninguna afirmación sobre cuál texto describe mejor la realidad — si sientes la tentación de
escribir algo como "por lo tanto X tiene razón" o "el argumento correcto es el de Y", es la señal de que te saliste
del límite de esta tarea; reformula en términos de estructura y rigor solamente.
`.trim();

  const user = `Análisis A — "${analisisA.metaTitulo || "(sin título)"}" (${analisisA.metaAutor || "autor no especificado"}):

Reporte:
${analisisA.reporte}

Tripletas:
${analisisA.tripletas}

---

Análisis B — "${analisisB.metaTitulo || "(sin título)"}" (${analisisB.metaAutor || "autor no especificado"}):

Reporte:
${analisisB.reporte}

Tripletas:
${analisisB.tripletas}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      // Empaquetado junto con su justificación en un solo objeto (en vez de un booleano suelto seguido de un
      // string suelto): un string suelto justo después de un booleano resultó ser el campo más fácil de
      // rellenar con relleno bajo presión (llegó a salir literalmente "{\"description\":\"placeholder\"}") —
      // misma forma que ya funciona en firmezaPuenteA/B, no una instrucción de prosa más fuerte.
      analisisProblema: {
        type: "object",
        properties: {
          mismoProblema: { type: "boolean" },
          justificacion: {
            type: "string",
            description: "Sustantiva y específica de ambos análisis — nunca una frase genérica.",
          },
        },
        required: ["mismoProblema", "justificacion"],
      },
      firmezaPuenteA: {
        type: "object",
        properties: {
          firme: { type: "boolean" },
          justificacion: { type: "string" },
        },
        required: ["firme", "justificacion"],
      },
      firmezaPuenteB: {
        type: "object",
        properties: {
          firme: { type: "boolean" },
          justificacion: { type: "string" },
        },
        required: ["firme", "justificacion"],
      },
      sintesis: {
        type: "string",
        description:
          "Solo estructura y rigor — nunca declara cuál descripción es más cercana a la realidad.",
      },
    },
    required: ["analisisProblema", "firmezaPuenteA", "firmezaPuenteB", "sintesis"],
  };

  return {
    system,
    user,
    toolName: "reportar_comparacion",
    toolDescription:
      "Reporta la comparación estructural entre dos análisis ya terminados, sin declarar cuál describe mejor la realidad.",
    inputSchema,
  };
}
