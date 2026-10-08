import type { Veredicto, PasajePersuasivo, TipoCambioVersion, EtiquetaTransicion } from "./types";

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
  Mixto: "Parcialmente abre el argumento",
};

/** Vocabulario de PRESENTACIÓN de la comparación entre versiones (los valores internos no cambian). */
export const ETIQUETAS_CAMBIO_VERSION: Record<TipoCambioVersion, string> = {
  cosmetico: "Solo redacción",
  problema: "Cambia el problema",
  explicacion_anadida: "Explicación añadida",
  explicacion_quitada: "Explicación quitada",
  contenido_sin_explicacion: "Contenido que no explica",
  afirmacion_modificada: "Afirmación modificada",
};

export const ETIQUETAS_TRANSICION: Record<EtiquetaTransicion, string> = {
  avance: "Avance: de Frágil a Firme",
  sin_cambio: "Sin cambio",
  cambio: "Cambió",
  no_comparable: "No comparable: cambió el problema",
  sin_pareja: "Sin pareja en la versión anterior",
};
