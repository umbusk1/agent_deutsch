// Helpers compartidos por cualquier paso que aplique el test de despojo (aislar → despojar → evaluar) y derive
// su mecanismo de un desglose oración por oración en vez de un autoreporte directo del modelo — hoy: el
// escaneo de persuasión de todo el artículo (step1BPrompt) y la re-clasificación de un fragmento editado en
// Mejora (mejoraDespojoPasajePrompt). Extraído de la ruta de Mejora-pasaje (2026-09-29) al extender el mismo
// arreglo al escaneo original — un solo lugar para esta lógica, no dos copias que puedan divergir.

export type EntradaAnalisisPorOracion = {
  oracion: string;
  sobreviveDespojo: boolean;
  razon: string;
};

/** El mecanismo NUNCA lo decide el modelo directamente — se calcula acá, a partir del desglose oración por
 * oración que sí tuvo que hacer. Todas sobreviven -> Racional; ninguna sobrevive -> AntiRacional; mezcla ->
 * Mixto. Confirmado con un caso real (Mejora-pasaje, 2026-09-28): pidiéndole un "mecanismo" directo para el
 * fragmento completo, el modelo lo declaraba "Racional" de forma holística aunque una sola oración no
 * sobreviviera el despojo por sí sola. */
export function calcularMecanismo(
  analisisPorOracion: EntradaAnalisisPorOracion[]
): "Racional" | "AntiRacional" | "Mixto" {
  if (analisisPorOracion.length === 0) return "AntiRacional"; // no debería pasar; conservador si pasa
  const todasSobreviven = analisisPorOracion.every((o) => o.sobreviveDespojo);
  if (todasSobreviven) return "Racional";
  const ningunaSobrevive = analisisPorOracion.every((o) => !o.sobreviveDespojo);
  if (ningunaSobrevive) return "AntiRacional";
  return "Mixto";
}

function sinEspacios(s: string): string {
  return s.replace(/\s+/g, "");
}

/** El modelo podría, en teoría, devolver un desglose que "suene" completo sin cubrir realmente todo el
 * fragmento (una oración de más, una de menos, una parafraseada en vez de citada) — eso invalidaría
 * calcularMecanismo en silencio, porque el agregado se calcula sobre oraciones que ya no representan el
 * fragmento real. Se verifica concatenando (ignorando espacios, nunca puntuación exacta de por medio porque el
 * modelo puede normalizar comillas/guiones al citar) contra la cita original — si no reconstruye, es un error
 * explícito, nunca una clasificación silenciosa sobre datos que no se pudieron verificar. */
export function oracionesReconstruyenTexto(
  analisisPorOracion: { oracion: string }[],
  textoOriginal: string
): boolean {
  const reconstruido = analisisPorOracion.map((o) => o.oracion).join("");
  return sinEspacios(reconstruido) === sinEspacios(textoOriginal);
}
