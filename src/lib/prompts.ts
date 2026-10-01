import type Anthropic from "@anthropic-ai/sdk";
import type {
  Explicacion,
  Problema,
  VarianteAceptada,
  Veredicto,
  Relacion,
  PasajePersuasivo,
  Alcance,
  IdentificacionVariante,
} from "./types";
import { ETIQUETAS_VEREDICTO } from "./etiquetas";

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

Ese español debe ser SIEMPRE tuteo neutro latinoamericano (tú, hablas, puedes, genera) — nunca voseo (vos, hablás,
podés, generá) ni modismos asociados a un país en particular, ni siquiera dentro de un ejemplo de pregunta o
diálogo hipotético que incluyas en ese texto.
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

EL TEST OPERATIVO (tres pasos) — SE APLICA POR SEPARADO A CADA ORACIÓN DE CADA PASAJE, NUNCA AL PASAJE COMPLETO
DE UNA SOLA VEZ. Un pasaje de varias oraciones donde la mayoría sostiene algo real puede "sentirse" racional en
una lectura global aunque una sola cláusula todavía dependa por completo de la carga retórica — esa lectura
global es exactamente el error que este desglose existe para prevenir. No emitas ningún juicio de conjunto antes
de haber pasado cada oración por los tres pasos:

1. Aísla la oración o cláusula independiente (dentro del pasaje, que puede tener varias — ver GRANULARIDAD).
2. Despójala de la carga de lealtad/urgencia/tabú/autoridad, y quédate solo con la afirmación desnuda que hace.
3. Evalúa ESA ORACIÓN SOLA: ¿un lector crítico seguiría considerando esa afirmación desnuda por sus propios
   méritos? Si sí, sobrevive el despojo. Si no —si sin el envoltorio la afirmación se cae— no sobrevive.

Repórtalo en analisisPorOracion, una entrada por oración, ANTES de nada más. Recién con esas oraciones ya
juzgadas una por una tenés el pasaje clasificado: no hay un mecanismo "de conjunto" separado que decidas
después — nombra en justificacion, en prosa, lo que ese desglose ya estableció.

Nota importante: "el tono bajó de intensidad pero la sustancia sigue sin llegar" NO es sobrevivir el despojo —
bajar el volumen del envoltorio no es lo mismo que reemplazarlo por una razón. Juzga si cada oración por sí
misma sostiene algo verificable, no si suena más moderada que el resto del pasaje.

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
- analisisPorOracion: OBLIGATORIO, una entrada por cada oración o cláusula independiente de la cita, en el
  orden en que aparecen — este es el trabajo real, no un resumen posterior. Por cada una: oracion (cítala
  exacta), sobreviveDespojo (true/false, resultado del test de arriba aplicado a ESA oración sola), y razon
  (por qué, en una frase). El mecanismo final NUNCA lo decidís vos directamente — se calcula automáticamente a
  partir de este desglose (todas sobreviven → Racional; ninguna sobrevive → AntiRacional; mezcla → Mixto), así
  que la precisión de este campo es lo único que importa.
- tecnicas: una entrada por cada técnica de presión que sigue detectándose en las oraciones que NO
  sobrevivieron el despojo, en español (ej. "apelación a lealtad/traición", "urgencia que no da margen para
  pensar") — ninguna, si todas las oraciones de la cita sobrevivieron. Si un mismo pasaje combina más de una
  vía de presión, regístralas todas — no elijas una sola como dominante.
- justificacion: en español, una síntesis en prosa de lo que el desglose por oración ya estableció — nunca un
  juicio nuevo que no se derive de analisisPorOracion. Si el resultado terminará siendo Mixto, sé explícito
  sobre CUÁL oración concreta (cítala) es la que no sostiene nada por mérito propio.

Si tras leer todo el texto ninguna oración de ningún pasaje resulta en AntiRacional, igual puedes reportar los
pasajes donde todo sobrevivió el despojo (retórica apasionada que resistió el test); simplemente no fuerces
ninguna oración como no-sobreviviente si no la encuentras.
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
            analisisPorOracion: {
              type: "array",
              description: "Una entrada por cada oración/cláusula independiente de la cita, en orden — el desglose obligatorio del que se deriva el mecanismo final.",
              items: {
                type: "object",
                properties: {
                  oracion: { type: "string" },
                  sobreviveDespojo: { type: "boolean" },
                  razon: { type: "string" },
                },
                required: ["oracion", "sobreviveDespojo", "razon"],
                additionalProperties: false,
              },
            },
            tecnicas: {
              type: "array",
              items: { type: "string" },
              description: "Una o más técnicas de presión detectadas en las oraciones que no sobrevivieron el despojo, en español — vacío si todas sobrevivieron",
            },
            justificacion: { type: "string" },
          },
          required: ["cita", "analisisPorOracion", "tecnicas", "justificacion"],
          additionalProperties: false,
        },
      },
    },
    required: ["pasajes"],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "reportar_persuasion",
    toolDescription: "Reporta el desglose por oración de cada pasaje que apela a lealtad, urgencia, autoridad, tabú o vergüenza; el mecanismo (Racional/AntiRacional/Mixto) se calcula a partir de ese desglose, no lo decide el modelo directamente.",
    inputSchema,
  };
}

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

A veces resumen no es una paráfrasis prolija sino una cita real editada por el usuario — más cruda, a veces con
pronombres o referencias ("esto", "ellos", "esa medida") que dependen de una oración anterior que no viaja con el
fragmento aislado. Resuélvelas usando el texto original de arriba antes de clasificar. Si algo sigue siendo
ambiguo incluso con ese contexto completo, trátalo como parte del elemento fijo en vez de adivinar a qué se
refiere — una identificación conservadora es mejor que una inventada.
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

// Separado en dos partes DELIBERADAMENTE (no es solo un cambio de nombres): textoDelUsuario es lo único que la
// persona escribió de verdad — el resto, generadoPorElSistema, lo generó y calculó el sistema automáticamente
// (las variantes de sustitución propuestas, con su tipo, y el resultado de cada una; el veredicto final). Antes
// este objeto mezclaba ambas cosas sin distinción (ni siquiera traía el tipo de cada variante), y el modelo de
// la nota de mentor terminaba atribuyéndole al usuario haber "agregado" o "elegido" una variante que en realidad
// generó el sistema — confirmado en notas reales de producción. La separación en el tipo (y el texto explícito
// del prompt más abajo) existe para que esa confusión sea estructuralmente más difícil, no solo una instrucción
// de prosa que el modelo puede pasar por alto bajo presión.
type ResultadoParaNota = {
  textoDelUsuario: string;
  generadoPorElSistema: {
    veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
    justificacionVeredicto: string;
    variantes: {
      descripcion: string;
      tipo: "sustitucion_minima" | "conocimiento_nuevo";
      resultado: "rompe" | "sobrevive";
      justificacionResultado: string;
    }[];
  };
};

// Guardrail reforzado ACÁ (no solo en instrucciones generales) porque este es el único punto de todo el
// producto donde el modelo escribe prosa dirigida al usuario en respuesta directa a un texto que el usuario
// propuso — el lugar exacto donde "ayudar" se confunde más fácil con "escribir la frase por él".
const REGLA_NUNCA_PROPONER_REDACCION = `
NUNCA propongas una redacción alternativa, ni completa ni parcial — ni una frase, ni una palabra suelta a modo de
sugerencia, ni siquiera envuelta en "por ejemplo, algo como...". Tu trabajo es poner a prueba lo que el usuario
escribió, no escribir por él. Puedes nombrar QUÉ TIPO de problema tumbó el intento (ej. "el sujeto que actúa
sigue siendo intercambiable", "la cadena causal se rompe si cambia el actor concreto") — eso es diagnóstico, está
permitido y es justamente tu función. Lo que no puedes hacer es completar ese diagnóstico con una propuesta de
texto concreto. Si en algún momento se te pide directamente "¿qué pondrías tú?" o equivalente, rehúsate con
calidez, recordando en una frase que tu función acá es poner a prueba lo que el usuario escribe, no escribir por
él — nunca cedas ni "solo esta vez a modo de ejemplo".
`.trim();

export function mejoraNotaPrompt(
  mecanismoGeneral: string,
  razonFragil: string,
  intentoActual: ResultadoParaNota,
  intentoAnterior: ResultadoParaNota | null,
  numeroIntento: number
) {
  const system = `
${REGLA_JERGA}

${REGLA_IDIOMA}

Vas a redactar una nota breve, en tono de mentor cercano (nunca frío ni burocrático), para alguien que acaba de
reescribir un fragmento real de su propio artículo e intentó ponerlo a prueba con el mismo mecanismo de
sustitución mínima que ya conocés. Esta nota es lo único que va a leer después de este intento — tiene que
decirle con precisión qué pasó y por qué, sin jerga técnica y sin desplegar cada sustitución probada en detalle
(esas ya quedan visibles aparte, en la lista de resultados de este intento).

${REGLA_NUNCA_PROPONER_REDACCION}

AUTORÍA DE LOS DATOS (no te equivoques con esto, es crítico): en "Intento actual" y, si existe, "Intento
anterior", el campo textoDelUsuario es LO ÚNICO que la persona escribió — es el fragmento que reescribió, punto.
Todo lo que está bajo generadoPorElSistema (cada variante de sustitución propuesta, con su tipo y el resultado
de ponerla a prueba, y el veredicto final con su justificación) lo generó y calculó el sistema automáticamente —
el usuario nunca las vio ni las eligió antes de este resultado. Por lo tanto:
- NUNCA digas que el usuario "agregó", "cambió", "quitó", "probó" o "eligió" una variante o un sustituto — esas
  son acciones del sistema, no de él. Lo único que el usuario hizo, de punta a punta, fue reescribir
  textoDelUsuario.
- Cualquier variante con tipo "conocimiento_nuevo" SIEMPRE la agrega el sistema como una prueba adicional —
  nunca fue algo que el usuario pidió, decidió incluir o se le ocurrió agregar.
- Podés describir QUÉ reveló cada variante sobre el fragmento (ej. "una de las sustituciones que se probó
  mostró que..."), pero siempre en voz pasiva o atribuida al sistema/la prueba, nunca al usuario como agente de
  esa variante puntual.

Reglas de tono según el resultado de ESTE intento:
- Si el resultado es "DificilDeVariar": celébralo genuinamente como un logro — el fragmento reescrito ahora
  resiste el mismo tipo de sustitución que antes lo tumbaba. Nombra, en una frase, qué cambió que ahora sostiene
  el peso (sin decir "difícil de variar" ni "veredicto"; usa lenguaje llano).
- Si el resultado sigue siendo "FacilDeVariar" o "Mixta": no es un fracaso, es información — di con precisión
  qué lo tumbó (cuál sustitución sobrevivió y por qué eso revela que un detalle seguía siendo intercambiable) y
  hacia qué tipo de ajuste apunta esa señal, en términos de qué debilidad de ESTRUCTURA hay que resolver, nunca
  de qué palabras usar.
- Si el resultado es "SinSustitutoGenuino": explica que esta vez no se logró generar ningún sustituto genuino
  para ponerlo a prueba — no es ni un logro ni un fracaso, es una pregunta que queda abierta sobre este intento
  puntual.

Contraste obligatorio: ${
    intentoAnterior
      ? `este es el intento número ${numeroIntento}, y HAY un intento anterior — contrástalo explícitamente
contra ese intento anterior (qué cambió, si mejoró, empeoró, o se movió el problema a otro lugar del fragmento),
no lo trates como si fuera el primero.`
      : `este es el primer intento de esta sesión — no hay nada previo contra qué contrastar, así que no
inventes una comparación.`
  }

Usa mecanismoGeneral (fijo, nunca cambia entre intentos) y la razón original por la que esta explicación salió
frágil como contexto de fondo, pero la nota es sobre ESTE intento, no una reevaluación de todo el historial.
`.trim();

  const user = `Mecanismo general (fijo):\n${mecanismoGeneral}\n\nPor qué salió frágil originalmente:\n${razonFragil}\n\nIntento actual (número ${numeroIntento}):\n${JSON.stringify(
    intentoActual,
    null,
    2
  )}${
    intentoAnterior
      ? `\n\nIntento anterior, para contraste:\n${JSON.stringify(intentoAnterior, null, 2)}`
      : "\n\n(No hay intento anterior — es el primero de la sesión.)"
  }`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      notaMentor: {
        type: "string",
        description: "Nota breve en tono de mentor sobre este intento, con contraste explícito contra el anterior si lo hay. Nunca incluye una redacción alternativa propuesta.",
      },
    },
    required: ["notaMentor"],
  };

  return {
    system,
    user,
    toolName: "reportar_nota_mentor",
    toolDescription: "Reporta una nota breve en tono de mentor sobre el resultado de este intento de Mejora, sin proponer redacción alternativa.",
    inputSchema,
  };
}

// Misma separación deliberada que ResultadoParaNota (ver ese comentario): textoDelUsuario es lo único que la
// persona escribió; todo lo de generadoPorElSistema (mecanismo, desglose por oración, técnicas detectadas,
// justificación) lo calculó el sistema al reclasificar ese fragmento — acá no hay "variantes" como en
// Explicación, pero el mismo riesgo de atribución existe igual (ej. "el usuario eligió el mecanismo").
type ResultadoParaNotaPasaje = {
  textoDelUsuario: string;
  generadoPorElSistema: {
    mecanismo: "Racional" | "AntiRacional" | "Mixto";
    analisisPorOracion: { oracion: string; sobreviveDespojo: boolean; razon: string }[];
    tecnicas: string[];
    justificacion: string;
  };
};

/**
 * Re-aplica el mismo test de despojo de step1BPrompt (aislar → despojar → evaluar, con las mismas
 * distinciones de neutralidad e ingenio-vs-sarcasmo) a UN fragmento ya aislado y editado por el usuario — no
 * busca pasajes en todo el artículo, ya viene elegido. Sin mecanismo de sustitución acá (a diferencia de
 * Explicación): la pregunta no es "qué sustituto sobrevive", es "esta redacción concreta sobrevive el
 * despojo o no".
 */
export function mejoraDespojoPasajePrompt(
  texto: string,
  citaEditada: string,
  tecnicasOriginales: string[],
  versionAnterior: string | null
) {
  const system = `
${REGLA_JERGA}

${REGLA_IDIOMA}

Vas a aplicar el mismo test de despojo que ya se usa para identificar pasajes persuasivos en todo un artículo,
pero acá el fragmento ya viene aislado y editado por el usuario — tu única tarea es re-clasificarlo, no
buscarlo ni decidir si es "la unidad natural" de análisis.

El fragmento puede ser una cita real editada, con pronombres o referencias ("esto", "ellos", "esa medida") que
dependen de una oración anterior que no viaja con el fragmento aislado — resuélvelas usando el texto original de
abajo antes de clasificar. Si algo sigue siendo ambiguo incluso con ese contexto, trátalo conservadoramente en
vez de adivinar a qué se refiere.

${
  versionAnterior
    ? `Más abajo también tenés la VERSIÓN ANTERIOR de este mismo fragmento (la inmediatamente previa a este
intento — la cita original si es el primer intento, o el intento anterior si ya hubo alguno). Comparalas
explícitamente, frase por frase: ¿qué cambió? ¿el cambio hizo que alguna cláusula perdiera un sostén concreto
que antes tenía, aunque el resto del fragmento se vea bien? Mirar la diferencia puntual contra la versión
anterior suele revelar una cláusula que quedó floja cuando una impresión global del fragmento actual no lo
haría — no te quedes solo con esa impresión global.`
    : ""
}

EL TEST OPERATIVO (tres pasos) — SE APLICA POR SEPARADO A CADA ORACIÓN, NUNCA AL FRAGMENTO COMPLETO DE UNA SOLA
VEZ. Un fragmento de varias oraciones donde la mayoría sostiene algo real puede "sentirse" racional en una
lectura global aunque una sola cláusula todavía dependa por completo de la carga retórica — esa lectura global
es exactamente el error que este desglose existe para prevenir. No emitas ningún juicio de conjunto antes de
haber pasado cada oración por los tres pasos:

1. Aísla la oración o cláusula independiente (dentro del fragmento ya aislado, que puede tener varias).
2. Despójala de la carga de lealtad/urgencia/tabú/autoridad, y quédate solo con la afirmación desnuda que hace.
3. Evalúa ESA ORACIÓN SOLA: ¿un lector crítico seguiría considerándola por sus propios méritos? Si sí,
   sobrevive el despojo. Si no —si sin el envoltorio la afirmación se cae— no sobrevive.

Repórtalo en analisisPorOracion, una entrada por oración, ANTES de nada más. Recién con esas oraciones ya
juzgadas una por una tenés el fragmento clasificado: no hay un mecanismo "de conjunto" separado que decidas
después — nombra en justificacion, en prosa, lo que ese desglose ya estableció.

Nota importante: "el tono bajó de intensidad pero la sustancia sigue sin llegar" NO es sobrevivir el despojo —
bajar el volumen del envoltorio no es lo mismo que reemplazarlo por una razón. Juzga si cada oración por sí
misma sostiene algo verificable, no si suena más moderada que antes.

SALVAGUARDA DE NEUTRALIDAD (aplícala siempre, sin excepción)

Lenguaje vívido, indignación moral, metáfora, o apelación al miedo proporcionada al riesgo real, NO son
automáticamente anti-racionales. Solo cuenta cuando, al quitar el envoltorio, el argumento se cae — es decir,
cuando el envoltorio reemplaza al argumento en vez de acompañarlo.

INGENIO/IRONÍA vs. SARCASMO/DESCALIFICACIÓN (aplica esto cuando el envoltorio sea humor, ironía o burla)

- Ingenio o ironía que COMPRIME un argumento real: despojado de su gracia, deja una afirmación sustantiva y
  verificable en pie por sus propios méritos. Esto es Racional.
- Sarcasmo o burla que SUSTITUYE el argumento: al despojarlo de su tono burlón o desdeñoso, no queda ninguna
  afirmación verificable — solo desprecio hacia la postura o persona contraria. Esto es AntiRacional.

La pregunta que separa a los dos casos: después de quitar el tono, ¿queda una afirmación que un lector crítico
podría investigar o refutar por sus propios méritos (ingenio), o queda solo una actitud hacia el otro lado
(sarcasmo sustitutivo)?

QUÉ REGISTRAR

- analisisPorOracion: OBLIGATORIO, una entrada por cada oración o cláusula independiente del fragmento
  editado, en el orden en que aparecen — este es el trabajo real, no un resumen posterior. Por cada una:
  oracion (cítala exacta), sobreviveDespojo (true/false, resultado del test de arriba aplicado a ESA oración
  sola), y razon (por qué, en una frase). El mecanismo final NUNCA lo decidís vos directamente — se calcula
  automáticamente a partir de este desglose (todas sobreviven → Racional; ninguna sobrevive → AntiRacional;
  mezcla → Mixto), así que la precisión de este campo es lo único que importa.
- tecnicas: una entrada por cada técnica de presión que sigue detectándose en las oraciones que NO
  sobrevivieron el despojo (ninguna, si todas sobrevivieron). Si alguna oración pasó a ser racional, no le
  asignes vocabulario de presión — nombra en cambio, para esas, qué aporta si corresponde (ej. "tensión real
  expuesta con ironía").
- justificacion: en español, una síntesis en prosa de lo que el desglose por oración ya estableció — nunca un
  juicio nuevo que no se derive de analisisPorOracion. Si el resultado terminará siendo Mixto, sé explícito
  sobre CUÁL oración concreta (cítala) es la que no sostiene nada por mérito propio.
`.trim();

  const user = `Texto original (para contexto, resolver pronombres/referencias):\n\n${texto}\n\nTécnicas identificadas originalmente en la versión sin editar (solo referencia, no vinculante):\n${tecnicasOriginales.join(", ") || "(ninguna registrada)"}${
    versionAnterior
      ? `\n\nVersión anterior de este mismo fragmento (para contexto de qué cambió, no para el desglose por oración en sí, que se aplica a la versión editada de abajo):\n${versionAnterior}`
      : ""
  }\n\nFragmento editado a clasificar:\n${citaEditada}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      analisisPorOracion: {
        type: "array",
        description: "Una entrada por cada oración/cláusula independiente del fragmento, en orden — el desglose obligatorio del que se deriva el mecanismo final.",
        items: {
          type: "object",
          properties: {
            oracion: { type: "string" },
            sobreviveDespojo: { type: "boolean" },
            razon: { type: "string" },
          },
          required: ["oracion", "sobreviveDespojo", "razon"],
          additionalProperties: false,
        },
      },
      tecnicas: { type: "array", items: { type: "string" } },
      justificacion: { type: "string" },
    },
    required: ["analisisPorOracion", "tecnicas", "justificacion"],
    additionalProperties: false,
  };

  return {
    system,
    user,
    toolName: "reportar_reclasificacion_pasaje",
    toolDescription: "Reporta el desglose por oración del test de despojo; el mecanismo (Racional/AntiRacional/Mixto) se calcula a partir de ese desglose, no lo decide el modelo directamente.",
    inputSchema,
  };
}

export function mejoraNotaPasajePrompt(
  tecnicasOriginales: string[],
  razonDespojo: string,
  intentoActual: ResultadoParaNotaPasaje,
  intentoAnterior: ResultadoParaNotaPasaje | null,
  numeroIntento: number
) {
  const system = `
${REGLA_JERGA}

${REGLA_IDIOMA}

Vas a redactar una nota breve, en tono de mentor cercano (nunca frío ni burocrático), para alguien que acaba de
reescribir un pasaje persuasivo real de su propio artículo e intentó que sobreviviera el mismo test de despojo
que ya conocés. Esta nota es lo único que va a leer después de este intento.

${REGLA_NUNCA_PROPONER_REDACCION}

AUTORÍA DE LOS DATOS (no te equivoques con esto, es crítico): en "Intento actual" y, si existe, "Intento
anterior", el campo textoDelUsuario es LO ÚNICO que la persona escribió. Todo lo que está bajo
generadoPorElSistema (mecanismo, el desglose oración por oración, las técnicas detectadas, la justificación) lo
calculó el sistema al reclasificar ese fragmento — el usuario no lo decidió ni lo eligió. Nunca digas que el
usuario "agregó" una técnica, "quitó" la carga retórica o "eligió" el mecanismo: esas son conclusiones del
sistema sobre el texto, no acciones que el usuario haya tomado conscientemente más allá de reescribirlo.

GUARDRAIL ESPECÍFICO DE ESTE TIPO DE HALLAZGO (además de los de arriba): premia que aparezca una razón sustantiva
real detrás del envoltorio retirado — NUNCA que simplemente hayan desaparecido las palabras cargadas. Si el
fragmento quitó una frase como "chantaje grosero" pero no puso ningún argumento sustantivo en su lugar, el
fragmento SIGUE cerrando el argumento (AntiRacional) aunque suene más moderado — decilo con esa claridad. No
confundas "más suave de tono" con "sobrevive el despojo": son preguntas distintas, y solo la segunda es la que
importa acá. El maquillaje retórico no es una mejora, es la misma falla con otro envoltorio.

Reglas de tono según el resultado de ESTE intento:
- Si el resultado es "Racional": celébralo genuinamente como un logro — el fragmento reescrito ahora deja una
  afirmación sustantiva en pie por sus propios méritos, sin depender de la presión del envoltorio. Nombra, en
  una frase, cuál es esa afirmación que ahora sostiene el peso.
- Si el resultado sigue siendo "AntiRacional": no es un fracaso, es información — di con precisión qué seguía
  faltando (¿desapareció la carga pero no llegó ningún argumento en su lugar? ¿el argumento nuevo tampoco
  sostiene la afirmación?) y hacia qué tipo de ajuste apunta, en términos de qué le falta a la SUSTANCIA, nunca
  de qué palabras usar.
- Si el resultado es "Mixto": no lo trates como logro completo ni como fracaso — es un avance real y parcial,
  dilo así. Sé tan específico como el diagnóstico lo permita: nombra, citando la frase exacta, cuál parte del
  fragmento ya sostiene algo por mérito propio (celebra ESA parte puntual) y cuál frase o cláusula concreta
  todavía pide ser aceptada por su peso emocional sin argumento detrás — la nota no cumple su función si dice
  "en parte funciona" sin señalar textualmente cuál parte es la que sigue floja. Para esto tenés
  generadoPorElSistema.analisisPorOracion en el intento actual (y en el anterior, si lo hay): son las oraciones
  exactas que ya se evaluaron una por una, con sobreviveDespojo y su razón — usalo como fuente de las citas
  textuales en vez de re-derivarlas de la síntesis en prosa de justificacion.

Contraste obligatorio: ${
    intentoAnterior
      ? `este es el intento número ${numeroIntento}, y HAY un intento anterior — contrástalo explícitamente
contra ese intento anterior (qué cambió, si mejoró, empeoró, o si solo cambió el tono sin cambiar la sustancia),
no lo trates como si fuera el primero.`
      : `este es el primer intento de esta sesión — no hay nada previo contra qué contrastar, así que no
inventes una comparación.`
  }
`.trim();

  const user = `Técnicas identificadas originalmente:\n${tecnicasOriginales.join(", ") || "(ninguna registrada)"}\n\nPor qué no sobrevivió el despojo originalmente:\n${razonDespojo}\n\nIntento actual (número ${numeroIntento}):\n${JSON.stringify(
    intentoActual,
    null,
    2
  )}${
    intentoAnterior
      ? `\n\nIntento anterior, para contraste:\n${JSON.stringify(intentoAnterior, null, 2)}`
      : "\n\n(No hay intento anterior — es el primero de la sesión.)"
  }`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      notaMentor: {
        type: "string",
        description: "Nota breve en tono de mentor sobre este intento, con contraste explícito contra el anterior si lo hay. Nunca incluye una redacción alternativa propuesta ni premia el solo cambio de tono sin sustancia.",
      },
    },
    required: ["notaMentor"],
  };

  return {
    system,
    user,
    toolName: "reportar_nota_mentor_pasaje",
    toolDescription: "Reporta una nota breve en tono de mentor sobre el resultado de este intento de Mejora de pasaje persuasivo.",
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
paso, por separado, redacta la sección sobre persuasión (pasajes que apelan a lealtad, urgencia, autoridad, tabú
o vergüenza en vez de invitar al escrutinio) — no la menciones ni la anticipes, es independiente de esta.

Esta sección debe:

- Estar completamente en español, en Markdown, organizada con encabezados por explicación relevante.
- Ser compacta: UN párrafo por explicación — dos como máximo, y el segundo solo para la señal que sea
  genuinamente el hallazgo central de esa explicación, no un dato secundario que se agrega porque existe. Si
  hay más de una señal real de las de abajo compitiendo por ese espacio, ninguna desaparece del reporte para
  hacerle lugar a otra: la central se explaya en el segundo párrafo, las demás quedan como una cláusula de
  pocas palabras cada una en el primero — comprimir es acortar cada mención, nunca omitir una señal real. El
  detalle completo de cada sustitución intentada ya vive en otro lugar (tripletas.txt, y pronto el módulo de
  Mejora) — este reporte no lo repite variante por variante: nombra el resultado y, en la misma frase, la razón
  más clara que lo sostiene.
- Nombra el resultado con su etiqueta tal como la ve el usuario en la app — "${ETIQUETAS_VEREDICTO.DificilDeVariar}",
  "${ETIQUETAS_VEREDICTO.FacilDeVariar}", "${ETIQUETAS_VEREDICTO.Mixta}" o "${ETIQUETAS_VEREDICTO.SinSustitutoGenuino}"
  según corresponda — esa etiqueta no es jerga, es el mismo vocabulario que el usuario ya ve en la app.
- NUNCA mencionar a David Deutsch, Karl Popper, "difícil de variar", "fácil de variar", "falsable", "conjetura"
  ni ningún otro término técnico del método.
- Si el resultado es "${ETIQUETAS_VEREDICTO.DificilDeVariar}", ancla la afirmación con una cláusula breve (no un
  párrafo aparte) a que es evidencia a favor tras un número limitado de intentos (2-3 sustituciones probadas),
  no una prueba exhaustiva.
- Si el resultado es "${ETIQUETAS_VEREDICTO.SinSustitutoGenuino}", trátala con menos confianza que a las
  explicaciones puestas a prueba (no se encontró ninguna alternativa genuina con la cual competir, así que su
  solidez sigue sin verificarse) y no le atribuyas preguntas nuevas ni alcance — en una sola frase, no en un
  tratamiento extendido. Aclara que no es lo mismo que "${ETIQUETAS_VEREDICTO.FacilDeVariar}" ni que
  "${ETIQUETAS_VEREDICTO.DificilDeVariar}": es, literalmente, una pregunta abierta sobre el texto.
- resisteConocimientoNuevo es una observación DISTINTA del resultado principal — nunca la fusiones en una sola
  frase de causa-efecto (nunca digas que la explicación "es ${ETIQUETAS_VEREDICTO.Mixta} porque no resistió el
  conocimiento nuevo": esa variante nunca cuenta para el resultado principal). Cuando el dato exista (no es
  null), SIEMPRE súmala como una cláusula corta en el mismo párrafo — nunca la omitas porque la explicación ya
  tenga otro hallazgo central compitiendo por espacio; comprímela en vez de descartarla. Nunca uses las palabras
  "predicción" ni "profecía".
- Si una explicación tiene una conexión sin argumentar (puenteLaguna=true), o un supuesto sin argumentar
  (premisaValorOculta.presente=true), o una imagen central que carga más peso persuasivo que el mecanismo lógico
  (imagenCentral.presente=true, típicamente junto a un resultado "${ETIQUETAS_VEREDICTO.FacilDeVariar}"), súmalo
  como una cláusula breve dentro del mismo párrafo, nombrando qué se asume sin argumentar o qué imagen carga esa
  connotación (usa la justificación/imagen/connotación entregadas) — no como su propia nota aparte, salvo que sea
  el hallazgo central de esa explicación. Estos hallazgos pueden convivir en la misma explicación: cada uno se
  menciona, ninguno reemplaza a otro.
- Para las explicaciones con resultado firme, si abren preguntas nuevas y/o tienen alcance amplio o limitado,
  menciónalo también como una cláusula en el mismo párrafo (quién la reconoce, si generalizaría a otros casos) —
  trata ambos alcances como hallazgos legítimos, no como una nota de calidad.
- Si hay explicaciones rivales o complementarias, mencionarlo en una frase breve, no en un párrafo aparte.
- Si hay problemas que el texto plantea pero para los que no se ofrece ninguna explicación (ver
  "problemasSinExplicacion" en los datos), menciónalos brevemente como preguntas que el texto deja abiertas o
  sin resolver — un hallazgo legítimo sobre el texto, no un defecto de este análisis.

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

export function step7PersuasionPrompt(pasajesConPresion: PasajePersuasivo[], pasajesDescartados: number) {
  const system = `
Vas a redactar la SECCIÓN DE PERSUASIÓN de un reporte crítico más grande sobre un texto de opinión. Otro paso,
por separado, redacta la sección sobre la calidad de las explicaciones del texto — no la menciones ni la
anticipes, es independiente de esta.

Vas a recibir una lista de pasajes con mecanismo AntiRacional o Mixto: pasajes que, al menos en parte, le piden
al lector dejar de cuestionar una afirmación (por lealtad, urgencia, autoridad, tabú o vergüenza anticipada).
Cada uno trae su mecanismo y, cuando aplica, oracionesQueNoSobreviven — las oraciones puntuales de la cita que
no sostienen nada por mérito propio.

- Si el mecanismo es AntiRacional: al quitarle el envoltorio a todo el pasaje, el argumento se cae por
  completo. Descríbelo como ya se hacía: qué le pide al lector, por qué vía, y por qué ese envoltorio
  reemplaza al argumento en vez de acompañarlo — por ejemplo: "este pasaje le pide al lector aceptar la
  conclusión sin dejarle margen para dudar, apelando a la lealtad hacia X y presentando cualquier duda como una
  forma de traición — un envoltorio que, quitado, deja la afirmación central sin apoyo propio."
- Si el mecanismo es Mixto: el pasaje sostiene algo real en su mayor parte — NO lo trates como si todo él
  cerrara el argumento. Nombra, citando la frase exacta de oracionesQueNoSobreviven, cuál cláusula puntual
  sigue dependiendo de la carga retórica sin argumento detrás, y reconoce en la misma frase que el resto del
  pasaje sí se sostiene por mérito propio — por ejemplo: "el pasaje describe con precisión verificable qué hace
  la aplicación, pero cierra con 'X', una frase que no dice qué acción concreta constituye ese compromiso."

Redáctalos en prosa crítica común, completamente en español, sin jerga técnica. Nunca uses las palabras "meme",
"racional", "anti-racional" ni "mixto", y nunca menciones a David Deutsch.

Si la lista de pasajes viene vacía, NO afirmes sin más que "no se encontraron pasajes...": si pasajesDescartados
(más abajo) es mayor que 0, en vez de eso escribe una frase que reconozca que uno o más pasajes no pudieron
clasificarse con confianza y quedaron fuera de esta revisión — nunca afirmes una ausencia de hallazgos cuando en
realidad hay algo sin revisar. Solo si pasajesDescartados es 0 y la lista está vacía, escribe la frase de
ausencia genuina (ej. "el análisis no encontró pasajes que le pidan al lector suspender el juicio en vez de
sostenerlo con razones"), sin usar jerga ni inventar un hallazgo que no hubo.

Si pasajesDescartados es mayor que 0 y SÍ hay pasajes en la lista (no vino vacía), igual sumá al final de la
sección una frase breve y aparte que lo mencione (ej. "un pasaje adicional no pudo clasificarse con confianza y
quedó fuera de esta revisión") — no lo omitas solo porque ya hay otros hallazgos que reportar.

IMPORTANTE: NO escribas ninguna conclusión general ni valoración global del texto completo — eso lo redacta otro
paso por separado, que necesita ser la única conclusión del reporte final.
`.trim();

  const user = `Pasajes con mecanismo AntiRacional o Mixto:\n${JSON.stringify(
    pasajesConPresion.map((p) => ({
      cita: p.cita,
      mecanismo: p.mecanismo,
      tecnicas: p.tecnicas,
      justificacion: p.justificacion,
      oracionesQueNoSobreviven: (p.analisisPorOracion ?? [])
        .filter((o) => !o.sobreviveDespojo)
        .map((o) => o.oracion),
    })),
    null,
    2
  )}\n\npasajesDescartados (pasajes que no se pudieron clasificar con confianza y quedaron fuera de esta revisión): ${pasajesDescartados}`;

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

export function step7EnsamblajePrompt(texto: string, seccionPrincipal: string, seccionPersuasion: string) {
  const system = `
Tu tarea en este paso tiene DOS partes, con propósitos completamente distintos — no dejes que una le quite
espacio a la otra, son trabajos independientes:

PARTE A — resumenInicial: un resumen NEUTRAL del texto original (lo recibís completo más abajo), de 300 a 400
palabras (orientativo, no un límite técnico exacto), describiendo la tesis y la estructura del artículo en los
propios términos del autor — qué plantea, cómo organiza su argumento, a qué conclusión llega. Esto es puramente
descriptivo: NUNCA evaluativo. No adelantes, insinúes ni prepares ninguna de las debilidades que las secciones ya
redactadas (parte B, más abajo) señalan — ni con el tono, ni seleccionando qué mencionar de forma que ya apunte
al problema, ni con calificativos que dejen ver hacia dónde va la crítica. El propósito es que el lector pueda
conectar por su cuenta lo que el texto planteó con la crítica que sigue después — no que se le entregue esa
conexión ya hecha. Si te cuesta evitar el tono evaluativo, es señal de que estás describiendo el texto a través
de la crítica que ya conoces en vez de a través de sus propios términos.

PARTE B — las PIEZAS DE ENLACE de un reporte crítico ya redactado en dos secciones separadas (una sobre la
calidad de las explicaciones del texto, otra sobre pasajes que apelan a lealtad, urgencia, autoridad, tabú o
vergüenza en vez de invitar al escrutinio) — las vas a recibir completas más abajo, solo como referencia. NO
reescribas ni reproduzcas el contenido de esas dos secciones: van a insertarse tal cual, sin tocarlas. Tu salida
acá son tres piezas cortas y nuevas:

- introduccion: 1-3 frases que abran el reporte completo, mencionando de forma natural que se va a hablar tanto
  de la calidad de las explicaciones como de cómo el texto trata al lector.
- transicion: 1-2 frases que conecten el final de la sección principal con el inicio de la sección de
  persuasión, solo si genuinamente hace falta para que no se sienta como un corte abrupto (si las dos secciones
  ya fluyen bien una detrás de otra, deja este campo como cadena vacía).
- cierre: una sola valoración general breve que sintetice tanto la calidad explicativa como los hallazgos de
  persuasión (cuando los haya) — esta es la única conclusión de todo el reporte, no repitas conclusiones que ya
  estén dentro de las dos secciones.

Todo en español, prosa llana, sin jerga. NUNCA menciones a David Deutsch, Karl Popper, "difícil de variar",
"falsable", "conjetura", "meme", "racional" ni "anti-racional". En la parte B no inventes hallazgos que no estén
ya en las dos secciones — ese trabajo es puramente de enlace editorial, no de análisis nuevo.
`.trim();

  const user = `Texto original (para el resumen neutral de la parte A):\n\n${texto}\n\nSección principal (explicaciones), para contexto de la parte B — no la reescribas:\n\n${seccionPrincipal}\n\nSección de persuasión, para contexto de la parte B — no la reescribas:\n\n${seccionPersuasion}`;

  const inputSchema: Schema = {
    type: "object",
    properties: {
      resumenInicial: {
        type: "string",
        description:
          "300-400 palabras (orientativo), resumen NEUTRAL de la tesis y estructura del texto original en sus propios términos — nunca evaluativo, nunca insinúa las debilidades que las otras secciones ya señalan.",
      },
      introduccion: { type: "string", description: "1-3 frases de apertura del reporte completo" },
      transicion: { type: "string", description: "1-2 frases de enlace entre secciones, o cadena vacía si no hace falta" },
      cierre: { type: "string", description: "Única valoración general de cierre del reporte completo" },
    },
    required: ["resumenInicial", "introduccion", "transicion", "cierre"],
  };

  return {
    system,
    user,
    toolName: "reportar_piezas_de_enlace",
    toolDescription: "Reporta el resumen neutral inicial y la introducción, transición y cierre que enlazan las dos secciones ya redactadas.",
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
