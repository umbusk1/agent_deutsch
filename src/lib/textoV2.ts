import type { Explicacion, MejoraSesion } from "./types";

export type CambioTextoV2 = {
  explicacionId: string;
  intentoId: string;
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
  citaOriginal: string;
  textoAplicado: string;
  /** Posición en el TEXTO ORIGINAL (no en TextoV2) — para pintar el antes/después contra la misma referencia. */
  inicio: number;
  fin: number;
};

export type ErrorTextoV2 = {
  explicacionId: string;
  tipo: "cita_no_encontrada" | "cita_duplicada" | "citas_solapadas" | "intento_no_encontrado";
  detalle: string;
};

export type TextoV2Resultado = {
  /**
   * null si CUALQUIER explicación con cambio aplicado no se pudo ubicar de forma inequívoca — nunca se arma un
   * texto parcial que aplique los cambios "fáciles" y deje los problemáticos en silencio con su redacción
   * vieja: eso produciría un artículo que se ve completo y actualizado sin estarlo genuinamente. Si hay algún
   * error, el llamador debe mostrar ese estado, no un texto de lectura.
   */
  texto: string | null;
  /** Los cambios que sí se pudieron ubicar sin ambigüedad, aunque el ensamblaje final haya fallado por otro
   * cambio distinto — útil para diagnóstico, nunca se usa para pintar una lectura si texto es null. */
  cambios: CambioTextoV2[];
  errores: ErrorTextoV2[];
};

/** ¿Hay al menos un cambio aplicado en alguna de estas sesiones? Más barato que ensamblar TextoV2 completo —
 * para el indicador de Biblioteca, que solo necesita un booleano, no el texto ensamblado. */
export function tieneCambioAplicado(sesiones: Iterable<MejoraSesion>): boolean {
  for (const sesion of sesiones) {
    if (sesion.aplicadoIntentoId) return true;
  }
  return false;
}

/**
 * Ensamblaje MECÁNICO: nunca pasa nada por el modelo, solo ubica cada Explicacion.cita en el texto original y
 * la reemplaza por el texto del intento aplicado, tal cual quedó guardado. Se calcula al vuelo cada vez que se
 * pide — no hay ninguna copia persistida de TextoV2 en ningún lado (ver el comentario de esa decisión en la
 * ruta que llama a esto).
 */
export function ensamblarTextoV2(
  texto: string,
  explicaciones: Explicacion[],
  sesiones: Map<string, MejoraSesion>
): TextoV2Resultado {
  const errores: ErrorTextoV2[] = [];

  type Posicion = CambioTextoV2;
  const posiciones: Posicion[] = [];

  for (const explicacion of explicaciones) {
    const sesion = sesiones.get(explicacion.id);
    if (!sesion || !sesion.aplicadoIntentoId) continue;

    const intento = sesion.intentos.find((i) => i.id === sesion.aplicadoIntentoId);
    if (!intento) {
      // No debería pasar (la ruta de aplicar ya valida que el intentoId exista antes de guardar), pero se
      // registra en vez de asumir — un dato inconsistente en Redis no debe pasar desapercibido.
      errores.push({
        explicacionId: explicacion.id,
        tipo: "intento_no_encontrado",
        detalle: `aplicadoIntentoId "${sesion.aplicadoIntentoId}" no existe entre los intentos guardados de esta sesión.`,
      });
      continue;
    }

    const cita = explicacion.cita;
    const ocurrencias: number[] = [];
    let desde = 0;
    for (;;) {
      const idx = texto.indexOf(cita, desde);
      if (idx === -1) break;
      ocurrencias.push(idx);
      desde = idx + 1;
    }

    if (ocurrencias.length === 0) {
      errores.push({
        explicacionId: explicacion.id,
        tipo: "cita_no_encontrada",
        detalle: "La cita de esta explicación no aparece en el texto original — no hay dónde insertar el cambio.",
      });
      continue;
    }
    if (ocurrencias.length > 1) {
      errores.push({
        explicacionId: explicacion.id,
        tipo: "cita_duplicada",
        detalle: `La cita aparece ${ocurrencias.length} veces en el texto original — no se puede determinar cuál instancia reemplazar sin adivinar.`,
      });
      continue;
    }

    const inicio = ocurrencias[0];
    posiciones.push({
      explicacionId: explicacion.id,
      intentoId: intento.id,
      veredicto: intento.veredicto,
      citaOriginal: cita,
      textoAplicado: intento.texto,
      inicio,
      fin: inicio + cita.length,
    });
  }

  // Todas las posiciones se calculan contra el texto ORIGINAL antes de tocar nada — nunca reemplazos
  // secuenciales que se pisen entre sí. Ordenar por inicio es lo que permite detectar solapamientos entre
  // explicaciones distintas en un solo barrido.
  posiciones.sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < posiciones.length; i++) {
    const anterior = posiciones[i - 1];
    const actual = posiciones[i];
    if (actual.inicio < anterior.fin) {
      errores.push({
        explicacionId: actual.explicacionId,
        tipo: "citas_solapadas",
        detalle: `La cita de esta explicación se solapa con la de ${anterior.explicacionId} en el texto original.`,
      });
      errores.push({
        explicacionId: anterior.explicacionId,
        tipo: "citas_solapadas",
        detalle: `La cita de esta explicación se solapa con la de ${actual.explicacionId} en el texto original.`,
      });
    }
  }

  if (errores.length > 0) {
    return { texto: null, cambios: posiciones, errores };
  }
  if (posiciones.length === 0) {
    // No hay ningún cambio aplicado — el llamador decide qué significa esto (normalmente: TextoV2 no existe
    // para este análisis todavía), no es un error de ensamblaje.
    return { texto: null, cambios: [], errores: [] };
  }

  let resultado = "";
  let cursor = 0;
  for (const p of posiciones) {
    resultado += texto.slice(cursor, p.inicio);
    resultado += p.textoAplicado;
    cursor = p.fin;
  }
  resultado += texto.slice(cursor);

  return { texto: resultado, cambios: posiciones, errores: [] };
}
