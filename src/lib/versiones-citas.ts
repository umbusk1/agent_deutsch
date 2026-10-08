/**
 * Verificación de citas para la comparación entre versiones. Es la misma regla de la Prueba 2
 * (experimento-versiones-prompts.ts), copiada acá a propósito: los archivos de los experimentos son
 * temporales y se borran al final, y esto es parte del producto.
 *
 * Regla: la cita se divide por "..." o "…"; cada parte se normaliza; se ignoran las partes de menos de 4
 * caracteres tras normalizar; la cita es válida solo si TODAS las partes que quedan están, normalizadas, en
 * el texto normalizado. Una cita vacía no es válida ni inválida.
 */
import type { CitaVerificadaVersion } from "./types";

export function normalizar(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function verificarCita(cita: unknown, texto: string): CitaVerificadaVersion {
  const original = typeof cita === "string" ? cita : "";
  if (!original.trim()) {
    return { texto: original, vacia: true, valida: null, partes: 0 };
  }
  const textoNormalizado = normalizar(texto);
  const partes = original
    .split(/\.\.\.|…/)
    .map((parte) => normalizar(parte))
    .filter((parte) => parte.length >= 4);
  if (partes.length === 0) {
    return { texto: original, vacia: false, valida: false, partes: 0 };
  }
  const valida = partes.every((parte) => textoNormalizado.includes(parte));
  return { texto: original, vacia: false, valida, partes: partes.length };
}
