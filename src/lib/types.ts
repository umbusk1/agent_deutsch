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
