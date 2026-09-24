import type { Veredicto, PasajePersuasivo } from "./types";

/**
 * Vocabulario de PRESENTACIÓN: cómo se muestran en pantalla los valores internos de veredicto/mecanismo.
 * Los nombres internos (valores de enum, claves de Redis, tripletas.txt) nunca cambian — solo lo que lee
 * el usuario. Único lugar a tocar si el tono vuelve a ajustarse — mismo principio que separar
 * REGLA_IDIOMA/REGLA_JERGA de CRITERIO_CENTRAL en prompts.ts.
 */

/** Etiqueta del campo "veredicto" en sí (encabezados, nombres de columna/sección). */
export const ETIQUETA_CAMPO_VEREDICTO = "Resultado";

export const ETIQUETAS_VEREDICTO: Record<Veredicto["veredicto"], string> = {
  DificilDeVariar: "Firme",
  FacilDeVariar: "Frágil",
  Mixta: "Parcialmente firme",
  SinSustitutoGenuino: "Sin poner a prueba todavía",
};

export const ETIQUETAS_MECANISMO: Record<PasajePersuasivo["mecanismo"], string> = {
  Racional: "Abre el argumento",
  AntiRacional: "Cierra el argumento",
};
