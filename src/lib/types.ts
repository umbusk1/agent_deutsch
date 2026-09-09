export type Explicacion = {
  id: string;
  cita: string;
  resumen: string;
};

export type Descartada = {
  cita: string;
  tipo: "narracion" | "descripcion" | "juicio_normativo";
  motivo: string;
};

export type Problema = {
  id: string;
  explicacionId: string;
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
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
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
