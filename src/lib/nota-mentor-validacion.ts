import { callTool } from "./anthropic";
import { registrarNotaMentorRechazada } from "./nota-mentor-rechazos";

/**
 * Verificación post-generación de la nota de mentor (Mejora): detecta dos clases de falla observadas en
 * notas reales — registro voseo (el producto usa español neutro, sin modismos regionales) y corrupción de
 * codificación (caracteres que delatan un problema de encoding, no una elección de redacción del modelo).
 *
 * Lista de voseo ACOTADA a formas inequívocas, a propósito: un patrón de sufijo (ej. "termina en -és" o
 * "-á") dispara falsos positivos con palabras de tuteo normal como "además" o "francés". Cada palabra de
 * esta lista NUNCA aparece en tuteo estándar — son conjugaciones o imperativos exclusivos del voseo.
 */
// Deliberadamente SIN imperativos en -í como "escribí", "seguí" o "viví": esa forma coincide exactamente con
// el pretérito de tuteo de la primera persona en verbos -ir regulares ("yo escribí", "yo seguí", "yo viví"),
// así que incluirla dispararía falsos positivos en tuteo normal. "decí" se queda porque no coincide con
// ningún pretérito común (el de "decir" es "dije", no "decí").
const PALABRAS_VOSEO = [
  "vos",
  "tenés",
  "podés",
  "querés",
  "sabés",
  "venís",
  "sentís",
  "pensás",
  "decís",
  "fijate",
  "mirá",
  "pensá",
  "probá",
  "agregá",
  "decí",
  "hacé",
  "poné",
  "tené",
  "revisá",
  "intentá",
  "tratá",
  "volvé",
  "andá",
  "decime",
  "acordate",
  "pensalo",
  "hacelo",
  "planteás",
  "buscás",
  "necesitás",
  "intentás",
  "pretendés",
  "esperás",
  "mostrás",
  "notás",
];

// Límites de palabra con \p{L}/\p{N} en vez de \b: \b de JS es ASCII (no trata á/í/é como parte de una
// palabra), así que "\bmirá\b" no cierra bien el límite después de la á. Esto además evita que "vos" matchee
// dentro de "vosotros" (la letra siguiente, "o", sigue siendo \p{L}, así que el lookahead niega el match).
const PATRON_VOSEO_CERRADO = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PALABRAS_VOSEO.join("|")})(?![\\p{L}\\p{N}])`,
  "giu"
);

// Regla GENERAL (en vez de enumerar cada verbo -ir): cualquier palabra terminada en "ís" tónico es presente
// de indicativo voseo (describís, vivís, compartís, insistís, etc.) — reemplaza tener que listar verbo por
// verbo. Excepciones: sustantivos que terminan en "ís" por coincidencia léxica, no por conjugación. "países"
// ya queda afuera estructuralmente (no termina en "ís" seguido de límite de palabra), pero se deja explícito
// por si algún día cambia el patrón.
const EXCEPCIONES_IS = new Set(["país", "países", "anís", "anises", "luís"]);
const PATRON_IS_GENERAL = /(?<![\p{L}\p{N}])(\p{L}+ís)(?![\p{L}\p{N}])/giu;

function detectarVoseo(texto: string): string | null {
  const m = texto.match(PATRON_VOSEO_CERRADO);
  if (m) return m[0];
  for (const coincidencia of texto.matchAll(PATRON_IS_GENERAL)) {
    const palabra = coincidencia[1];
    if (!EXCEPCIONES_IS.has(palabra.toLowerCase())) return palabra;
  }
  return null;
}

function detectarCaracterAnomalo(texto: string): string | null {
  if (texto.includes("�")) return "carácter de reemplazo Unicode (U+FFFD)";
  if (texto.includes("ı")) return "ı (i sin punto, U+0131)";
  // ¿/¡ pegado (sin espacio) a una letra minúscula inmediatamente anterior: nunca ocurre en español correcto
  // (¿/¡ siempre abren una cláusula, precedidos por espacio, inicio de string, u otro signo de puntuación) —
  // es la firma de una corrupción de codificación que reemplazó una vocal acentuada a mitad de palabra.
  if (/\p{Ll}[¿¡]/u.test(texto)) {
    return "¿ o ¡ pegado a una letra minúscula (posible corrupción de codificación)";
  }
  for (const ch of texto) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) {
      return `letra de escritura no latina ("${ch}")`;
    }
  }
  return null;
}

/** null si la nota pasa la verificación; si no, el motivo de rechazo (para loguear y para decidir reintento). */
export function motivoRechazoNota(nota: string): string | null {
  const voseo = detectarVoseo(nota);
  if (voseo) return `voseo detectado ("${voseo}")`;
  return detectarCaracterAnomalo(nota);
}

const AVISO_NOTA_NO_VERIFICADA =
  "Esta nota no se pudo redactar en el tono esperado, incluso después de reintentarlo — el resultado de este " +
  "intento (arriba) sigue siendo válido igual. Este intento cuenta para tu límite de intentos. Si quieres, " +
  "genera un nuevo intento para obtener una nota nueva.";

type NotaPrompt = Parameters<typeof callTool>[0];

/**
 * Genera la nota de mentor con un reintento si falla la verificación (ver motivoRechazoNota): el reintento le
 * señala explícitamente a Claude cuál fue el problema detectado en su respuesta anterior, en vez de pedirle
 * "de nuevo" a ciegas — mismo principio que el reintento de step4 (forma inválida) y step1b (desglose que no
 * reconstruye su cita), pero acá el problema se nombra en el propio prompt del reintento. Si el segundo
 * intento TAMBIÉN falla, se registra en Redis (motivo + primeros 200 caracteres de la nota rechazada, ver
 * nota-mentor-rechazos.ts) y se devuelve un aviso explícito en vez de una nota que no pasó la verificación.
 */
export async function generarNotaMentorVerificada(prompt: NotaPrompt, ruta: string): Promise<string> {
  const primerIntento = await callTool<{ notaMentor: string }>(prompt);
  const motivo1 = motivoRechazoNota(primerIntento.notaMentor);
  if (!motivo1) return primerIntento.notaMentor;

  console.error(
    `[${ruta}] nota de mentor rechazada (${motivo1}) — reintentando una vez con el problema señalado.`
  );
  const promptConAviso: NotaPrompt = {
    ...prompt,
    user: `${prompt.user}\n\nATENCIÓN: tu respuesta anterior a este mismo pedido fue rechazada automáticamente porque ${motivo1}. Reescribe la nota completa en español neutro, en tuteo estándar — nunca en voseo ("vos", "tenés", "mirá", etc.) — y sin caracteres corruptos.`,
  };
  const segundoIntento = await callTool<{ notaMentor: string }>(promptConAviso);
  const motivo2 = motivoRechazoNota(segundoIntento.notaMentor);
  if (!motivo2) return segundoIntento.notaMentor;

  console.error(
    `[${ruta}] nota de mentor sigue rechazada tras reintentar (${motivo2}) — se deja un aviso explícito en su lugar.`
  );
  await registrarNotaMentorRechazada(ruta, motivo2, segundoIntento.notaMentor);
  return AVISO_NOTA_NO_VERIFICADA;
}
