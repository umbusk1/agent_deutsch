export type Explicacion = {
  id: string;
  problemaId: string;
  cita: string;
  resumen: string;
  /** El mecanismo universal ("parroquial" no) que resumen aplica al caso concreto del texto. */
  mecanismoGeneral: string;
  /** Si esta explicación resuelve un problema local sin argumentar cómo se conecta con el maestro. */
  puente: {
    laguna: boolean;
    justificacion: string;
  };
  /** Si "resumen" (aplicación específica) le añade a "mecanismoGeneral" (versión despojada) una imagen o
   * analogía concreta que carga peso connotativo (moral, emocional) que el mecanismo desnudo no sostiene. */
  imagenCentral: {
    presente: boolean;
    imagen: string | null;
    connotacionAñadida: string | null;
  };
  /** Si el mecanismo mezcla una afirmación estructural/causal con un juicio de valor no argumentado sobre
   * cómo se experimentaría esa estructura (asumido como parte del hecho mismo, no defendido aparte). */
  premisaValorOculta: {
    presente: boolean;
    justificacion: string | null;
  };
};

export type Descartada = {
  cita: string;
  tipo: "narracion" | "descripcion" | "juicio_normativo";
  motivo: string;
};

export type Problema = {
  id: string;
  tipo: "maestro" | "local";
  enunciado: string;
};

export type VarianteAceptada = {
  id: string;
  explicacionId: string;
  descripcion: string;
  /** "conocimiento_nuevo" prueba algo distinto de una sustitución mínima de dominio — nunca cuenta para el
   * veredicto principal, se evalúa y reporta por separado (ver Veredicto.resisteConocimientoNuevo). */
  tipo: "sustitucion_minima" | "conocimiento_nuevo";
  /** Chequeo obligatorio del modelo, por variante: qué elemento fijo preciso preserva y por qué no es una
   * conflación conceptual (test de independencia lógica) — ver step3VariantesPrompt. */
  elementoFijoVerificado: string;
};

export type VarianteDescartada = {
  explicacionId: string;
  descripcion: string;
  motivo: string;
};

/** Salida del paso 1 de 2 de generación de variantes (ver step3IdentificarPrompt) — separa identificar qué es
 * fijo/variable de generar los sustitutos, para no mezclar ambas tareas en una sola llamada. */
export type IdentificacionVariante = {
  tipo: "actor_con_motivo" | "cadena_causal" | "hibrido";
  elementoFijo: string;
  ingredienteVariable: string;
  dominio: string;
};

export type ResultadoVariante = {
  varianteId: string;
  resultado: "rompe" | "sobrevive";
  justificacion: string;
};

export type Veredicto = {
  explicacionId: string;
  resultadosVariantes: ResultadoVariante[];
  /** Calculado SOLO sobre variantes de tipo "sustitucion_minima" — la de "conocimiento_nuevo" nunca cuenta aquí. */
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
  justificacion: string;
  /** Resultado de la variante de conocimiento nuevo, aparte del veredicto principal — null si no aplicaba
   * (la explicación no hacía ninguna afirmación sobre el futuro) o si no hubo sustituto genuino que evaluar. */
  resisteConocimientoNuevo: { resultado: "rompe" | "sobrevive"; justificacion: string } | null;
};

export type ProblemaNuevo = {
  id: string;
  explicacionId: string;
  enunciado: string;
  reconocidoPorAutor: "Si" | "No";
  justificacion: string;
};

export type Relacion = {
  explicacionAId: string;
  explicacionBId: string;
  tipo: "compite_con" | "complementa";
  justificacion: string;
};

export type Alcance = {
  explicacionId: string;
  tipo: "Amplio" | "Limitado";
  justificacion: string;
};

export type PasajePersuasivo = {
  id: string;
  cita: string;
  mecanismo: "Racional" | "AntiRacional";
  tecnicas: string[];
  justificacion: string;
};

export type Comparacion = {
  id: string;
  analisisAId: string;
  analisisBId: string;
  mismoProblema: boolean;
  justificacionProblema: string;
  /** Independiente por análisis — nunca se fusiona con "cuál describe mejor la realidad". */
  firmezaPuenteA: { firme: boolean; justificacion: string };
  firmezaPuenteB: { firme: boolean; justificacion: string };
  /** Síntesis de estructura y rigor — nunca declara cuál descripción es más cercana a la realidad. */
  sintesis: string;
  creadoPor: string;
  creadoEn: string;
};

/**
 * Un intento dentro de una sesión de Mejora de EXPLICACIÓN: el fragmento editado por el usuario y la salida
 * REAL del mismo mecanismo de Variantes/Resultado ya existente (step3Identificar → step3Variantes → step4),
 * sin resumir ni inferir nada después. Se persiste completo (no solo el veredicto final) para no perder
 * trazabilidad y para alimentar el ensamblaje de TextoV2 más adelante.
 */
export type IntentoMejoraExplicacion = {
  /** "I1".."I5" — secuencial dentro de la sesión; también el número que se muestra ("intento 3 de 5"). */
  id: string;
  /** El fragmento tal como se envió a evaluar en ESTE intento (no la cita original de la explicación). */
  texto: string;
  creadoEn: string;
  identificacion: IdentificacionVariante;
  variantes: VarianteAceptada[];
  resultadosVariantes: ResultadoVariante[];
  /** Mismo cuarto estado que el veredicto principal del análisis: si step3Variantes no logró generar ningún
   * sustituto genuino para este intento, el resultado es SinSustitutoGenuino, no FacilDeVariar ni DificilDeVariar
   * — no fue puesto a prueba, así que no hay base para llamarlo firme ni frágil. */
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
  justificacion: string;
  resisteConocimientoNuevo: { resultado: "rompe" | "sobrevive"; justificacion: string } | null;
  /** Nota narrada con tono de mentor para ESTE intento — contrasta contra el intento anterior. */
  notaMentor: string;
};

/**
 * Un intento dentro de una sesión de Mejora de PASAJE PERSUASIVO: el fragmento editado y la salida real del
 * mismo test de despojo ya existente (ver step1BPrompt/mejoraDespojoPasajePrompt) — no hay mecanismo de
 * sustitución acá, solo re-clasificación (Racional/AntiRacional) del fragmento editado.
 */
export type IntentoMejoraPasaje = {
  /** "I1".."IN" — secuencial dentro de la sesión (tope MAX_INTENTOS_PASAJE en mejora.ts). */
  id: string;
  texto: string;
  creadoEn: string;
  /** "Mixto": una parte del fragmento sostiene algo sustantivo y otra parte todavía se apoya en carga
   * emocional sin argumento — igual que Veredicto.veredicto tiene "Mixta" para el mismo motivo (no forzar un
   * binario a promediar en silencio cuando la evidencia real está dividida). Confirmado con un caso real
   * (2026-09-28): sin este estado, la nota de mentor describía correctamente un resultado mixto mientras el
   * campo mecanismo quedaba forzado a "Racional". mecanismo se CALCULA de analisisPorOracion (ver
   * calcularMecanismo en la ruta evaluar) — nunca lo reporta el modelo directamente. */
  mecanismo: "Racional" | "AntiRacional" | "Mixto";
  /** El desglose oración-por-oración del que se deriva mecanismo — persistido (no solo usado en el momento del
   * cálculo) para que la nota de mentor y cualquier vista de historial puedan citar la oración puntual que no
   * sobrevivió el despojo, en vez de depender solo de la síntesis en prosa de justificacion. */
  analisisPorOracion: { oracion: string; sobreviveDespojo: boolean; razon: string }[];
  tecnicas: string[];
  justificacion: string;
  notaMentor: string;
};

/**
 * Sesión de Mejora para UNA explicación de UN análisis guardado. Cubre solo explicaciones con veredicto
 * FacilDeVariar. `aplicadoIntentoId` es la única fuente de verdad de qué intento quedó aplicado — nunca se
 * infiere si fue "confirmado Firme" o no por la sola presencia de este campo: siempre hay que mirar el
 * `veredicto` del intento al que apunta (`intentos.find(i => i.id === aplicadoIntentoId)`), porque el usuario
 * puede aplicar un intento que no llegó a DificilDeVariar.
 */
export type MejoraSesionExplicacion = {
  tipo: "explicacion";
  id: string;
  analisisId: string;
  explicacionId: string;
  /** Snapshot fijo del mecanismoGeneral original — de solo lectura durante toda la sesión, nunca editable. */
  mecanismoGeneral: string;
  /** Snapshot de la justificación del veredicto original (por qué salió FacilDeVariar). */
  razonFragil: string;
  /** Máximo MAX_INTENTOS_EXPLICACION (5). */
  intentos: IntentoMejoraExplicacion[];
  aplicadoIntentoId: string | null;
  usuario: string;
  creadoEn: string;
  actualizadoEn: string;
};

/**
 * Sesión de Mejora para UN pasaje persuasivo de UN análisis guardado. Cubre solo pasajes con mecanismo
 * AntiRacional ("cierra el argumento"). Misma regla de "nunca inferido" que MejoraSesionExplicacion: mirar
 * siempre el `mecanismo` del intento al que apunta `aplicadoIntentoId`, nunca asumir que aplicado == Racional.
 */
export type MejoraSesionPasaje = {
  tipo: "pasaje";
  id: string;
  analisisId: string;
  pasajeId: string;
  /** Snapshot de las técnicas ya identificadas en el análisis original — de solo lectura. */
  tecnicasOriginales: string[];
  /** Snapshot de la justificación original de por qué no sobrevivió el despojo. */
  razonDespojo: string;
  /** Máximo MAX_INTENTOS_PASAJE (3). */
  intentos: IntentoMejoraPasaje[];
  aplicadoIntentoId: string | null;
  usuario: string;
  creadoEn: string;
  actualizadoEn: string;
};

export type MejoraSesion = MejoraSesionExplicacion | MejoraSesionPasaje;
