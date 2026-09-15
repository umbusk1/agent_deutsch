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
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
  justificacion: string;
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
