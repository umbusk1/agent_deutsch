import type { Explicacion, PasajePersuasivo, MejoraSesionExplicacion, MejoraSesionPasaje } from "./types";

export type CambioTextoV2Explicacion = {
  tipoHallazgo: "explicacion";
  explicacionId: string;
  intentoId: string;
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
  citaOriginal: string;
  textoAplicado: string;
  /** Posición en el TEXTO ORIGINAL (no en TextoV2) — para pintar el antes/después contra la misma referencia. */
  inicio: number;
  fin: number;
};

export type CambioTextoV2Pasaje = {
  tipoHallazgo: "pasaje";
  pasajeId: string;
  intentoId: string;
  mecanismo: "Racional" | "AntiRacional" | "Mixto";
  citaOriginal: string;
  textoAplicado: string;
  inicio: number;
  fin: number;
};

export type CambioTextoV2 = CambioTextoV2Explicacion | CambioTextoV2Pasaje;

export type ErrorTextoV2 = {
  tipoHallazgo: "explicacion" | "pasaje";
  hallazgoId: string;
  tipoError: "cita_no_encontrada" | "cita_duplicada" | "citas_solapadas" | "intento_no_encontrado";
  detalle: string;
};

export type TextoV2Resultado = {
  /**
   * null si CUALQUIER hallazgo con cambio aplicado (explicación o pasaje) no se pudo ubicar de forma
   * inequívoca — nunca se arma un texto parcial que aplique los cambios "fáciles" y deje los problemáticos en
   * silencio con su redacción vieja: eso produciría un artículo que se ve completo y actualizado sin estarlo
   * genuinamente. Si hay algún error, el llamador debe mostrar ese estado, no un texto de lectura.
   */
  texto: string | null;
  /** Los cambios que sí se pudieron ubicar sin ambigüedad, aunque el ensamblaje final haya fallado por otro
   * cambio distinto — útil para diagnóstico, nunca se usa para pintar una lectura si texto es null. */
  cambios: CambioTextoV2[];
  errores: ErrorTextoV2[];
};

/** ¿Hay al menos un cambio aplicado en alguna de estas sesiones? Más barato que ensamblar TextoV2 completo —
 * para el indicador de Biblioteca, que solo necesita un booleano, no el texto ensamblado. Sirve para sesiones
 * de explicación o de pasaje indistintamente — ambas comparten el campo aplicadoIntentoId. */
export function tieneCambioAplicado(
  sesiones: Iterable<MejoraSesionExplicacion | MejoraSesionPasaje>
): boolean {
  for (const sesion of sesiones) {
    if (sesion.aplicadoIntentoId) return true;
  }
  return false;
}

// Forma interna, unificada, de un candidato a reemplazo — independiente de si viene de una explicación o de
// un pasaje persuasivo. "resultado" guarda el veredicto/mecanismo crudo; se tipa de nuevo recién al construir
// el CambioTextoV2 público (paraCambioPublico), donde SÍ se sabe con certeza a cuál de los dos corresponde.
type Candidato = {
  tipoHallazgo: "explicacion" | "pasaje";
  hallazgoId: string;
  cita: string;
  intentoId: string;
  textoAplicado: string;
  resultado: string;
};
type PosicionInterna = Candidato & { inicio: number; fin: number };

function paraCambioPublico(p: PosicionInterna): CambioTextoV2 {
  if (p.tipoHallazgo === "explicacion") {
    return {
      tipoHallazgo: "explicacion",
      explicacionId: p.hallazgoId,
      intentoId: p.intentoId,
      veredicto: p.resultado as CambioTextoV2Explicacion["veredicto"],
      citaOriginal: p.cita,
      textoAplicado: p.textoAplicado,
      inicio: p.inicio,
      fin: p.fin,
    };
  }
  return {
    tipoHallazgo: "pasaje",
    pasajeId: p.hallazgoId,
    intentoId: p.intentoId,
    mecanismo: p.resultado as CambioTextoV2Pasaje["mecanismo"],
    citaOriginal: p.cita,
    textoAplicado: p.textoAplicado,
    inicio: p.inicio,
    fin: p.fin,
  };
}

/**
 * Ensamblaje MECÁNICO: nunca pasa nada por el modelo, solo ubica cada cita (de explicación o de pasaje
 * persuasivo) en el texto original y la reemplaza por el texto del intento aplicado, tal cual quedó guardado.
 * Se calcula al vuelo cada vez que se pide — no hay ninguna copia persistida de TextoV2 en ningún lado (ver el
 * comentario de esa decisión en la ruta que llama a esto).
 *
 * Misma lógica de siempre (calcular TODAS las posiciones contra el texto intacto, ordenar, detectar
 * solapamientos, recién ahí ensamblar) — solo que ahora alimentada desde dos orígenes en vez de uno, por eso
 * el primer bloque arma una lista de "candidatos" unificada antes de tocar posiciones.
 */
export function ensamblarTextoV2(
  texto: string,
  explicaciones: Explicacion[],
  sesionesExplicacion: Map<string, MejoraSesionExplicacion>,
  pasajes: PasajePersuasivo[],
  sesionesPasaje: Map<string, MejoraSesionPasaje>
): TextoV2Resultado {
  const errores: ErrorTextoV2[] = [];
  const candidatos: Candidato[] = [];

  for (const explicacion of explicaciones) {
    const sesion = sesionesExplicacion.get(explicacion.id);
    if (!sesion || !sesion.aplicadoIntentoId) continue;

    const intento = sesion.intentos.find((i) => i.id === sesion.aplicadoIntentoId);
    if (!intento) {
      // No debería pasar (la ruta de aplicar ya valida que el intentoId exista antes de guardar), pero se
      // registra en vez de asumir — un dato inconsistente en Redis no debe pasar desapercibido.
      errores.push({
        tipoHallazgo: "explicacion",
        hallazgoId: explicacion.id,
        tipoError: "intento_no_encontrado",
        detalle: `aplicadoIntentoId "${sesion.aplicadoIntentoId}" no existe entre los intentos guardados de esta sesión.`,
      });
      continue;
    }

    candidatos.push({
      tipoHallazgo: "explicacion",
      hallazgoId: explicacion.id,
      cita: explicacion.cita,
      intentoId: intento.id,
      textoAplicado: intento.texto,
      resultado: intento.veredicto,
    });
  }

  for (const pasaje of pasajes) {
    const sesion = sesionesPasaje.get(pasaje.id);
    if (!sesion || !sesion.aplicadoIntentoId) continue;

    const intento = sesion.intentos.find((i) => i.id === sesion.aplicadoIntentoId);
    if (!intento) {
      errores.push({
        tipoHallazgo: "pasaje",
        hallazgoId: pasaje.id,
        tipoError: "intento_no_encontrado",
        detalle: `aplicadoIntentoId "${sesion.aplicadoIntentoId}" no existe entre los intentos guardados de esta sesión.`,
      });
      continue;
    }

    candidatos.push({
      tipoHallazgo: "pasaje",
      hallazgoId: pasaje.id,
      cita: pasaje.cita,
      intentoId: intento.id,
      textoAplicado: intento.texto,
      resultado: intento.mecanismo,
    });
  }

  const posiciones: PosicionInterna[] = [];
  for (const candidato of candidatos) {
    const ocurrencias: number[] = [];
    let desde = 0;
    for (;;) {
      const idx = texto.indexOf(candidato.cita, desde);
      if (idx === -1) break;
      ocurrencias.push(idx);
      desde = idx + 1;
    }

    if (ocurrencias.length === 0) {
      errores.push({
        tipoHallazgo: candidato.tipoHallazgo,
        hallazgoId: candidato.hallazgoId,
        tipoError: "cita_no_encontrada",
        detalle: "La cita de este hallazgo no aparece en el texto original — no hay dónde insertar el cambio.",
      });
      continue;
    }
    if (ocurrencias.length > 1) {
      errores.push({
        tipoHallazgo: candidato.tipoHallazgo,
        hallazgoId: candidato.hallazgoId,
        tipoError: "cita_duplicada",
        detalle: `La cita aparece ${ocurrencias.length} veces en el texto original — no se puede determinar cuál instancia reemplazar sin adivinar.`,
      });
      continue;
    }

    const inicio = ocurrencias[0];
    posiciones.push({ ...candidato, inicio, fin: inicio + candidato.cita.length });
  }

  // Todas las posiciones se calculan contra el texto ORIGINAL antes de tocar nada — nunca reemplazos
  // secuenciales que se pisen entre sí. Ordenar por inicio es lo que permite detectar solapamientos entre
  // hallazgos distintos (de cualquiera de los dos orígenes) en un solo barrido.
  posiciones.sort((a, b) => a.inicio - b.inicio);
  for (let i = 1; i < posiciones.length; i++) {
    const anterior = posiciones[i - 1];
    const actual = posiciones[i];
    if (actual.inicio < anterior.fin) {
      errores.push({
        tipoHallazgo: actual.tipoHallazgo,
        hallazgoId: actual.hallazgoId,
        tipoError: "citas_solapadas",
        detalle: `La cita de este hallazgo se solapa con la de ${anterior.hallazgoId} en el texto original.`,
      });
      errores.push({
        tipoHallazgo: anterior.tipoHallazgo,
        hallazgoId: anterior.hallazgoId,
        tipoError: "citas_solapadas",
        detalle: `La cita de este hallazgo se solapa con la de ${actual.hallazgoId} en el texto original.`,
      });
    }
  }

  const cambios = posiciones.map(paraCambioPublico);

  if (errores.length > 0) {
    return { texto: null, cambios, errores };
  }
  if (posiciones.length === 0) {
    // No hay ningún cambio aplicado (de ningún origen) — el llamador decide qué significa esto (normalmente:
    // TextoV2 no existe para este análisis todavía), no es un error de ensamblaje.
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

  return { texto: resultado, cambios, errores: [] };
}
