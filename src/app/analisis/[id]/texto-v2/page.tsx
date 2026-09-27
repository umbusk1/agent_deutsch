"use client";

import { use, useEffect, useState } from "react";
import { ETIQUETAS_VEREDICTO, ETIQUETAS_MECANISMO } from "@/lib/etiquetas";

type CambioExplicacion = {
  tipoHallazgo: "explicacion";
  explicacionId: string;
  intentoId: string;
  veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta" | "SinSustitutoGenuino";
  citaOriginal: string;
  textoAplicado: string;
  inicio: number;
  fin: number;
};

type CambioPasaje = {
  tipoHallazgo: "pasaje";
  pasajeId: string;
  intentoId: string;
  mecanismo: "Racional" | "AntiRacional";
  citaOriginal: string;
  textoAplicado: string;
  inicio: number;
  fin: number;
};

type Cambio = CambioExplicacion | CambioPasaje;

type ErrorTextoV2 = {
  tipoHallazgo: "explicacion" | "pasaje";
  hallazgoId: string;
  tipoError: "cita_no_encontrada" | "cita_duplicada" | "citas_solapadas" | "intento_no_encontrado";
  detalle: string;
};

type Resultado = { texto: string | null; cambios: Cambio[]; errores: ErrorTextoV2[] };

export default function TextoV2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: analisisId } = use(params);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/analisis/${analisisId}/texto-v2`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setResultado(data);
      })
      .catch(() => setError("No se pudo cargar TextoV2 para este análisis."));
  }, [analisisId]);

  return (
    <div className="container">
      {/* Vista provisional: falta confirmar el diseño final (lectura limpia + desplegable de antes/después
          por fragmento) — esto solo demuestra que el ensamblaje mecánico funciona. */}
      <h1 style={{ marginBottom: "1rem" }}>TextoV2</h1>

      {error && <div className="error-banner">{error}</div>}
      {!resultado && !error && <p className="loading">Ensamblando TextoV2...</p>}

      {resultado && resultado.errores.length > 0 && (
        <div className="card">
          <div className="error-banner">
            No se pudo ensamblar TextoV2 de forma confiable — al menos un cambio aplicado no se pudo ubicar sin
            ambigüedad en el texto original.
          </div>
          {resultado.errores.map((e, i) => (
            <p key={i} className="warning-note">
              <strong>{e.hallazgoId}</strong> ({e.tipoError}): {e.detalle}
            </p>
          ))}
        </div>
      )}

      {resultado && resultado.texto !== null && (
        <div className="card">
          <div className="report-preview" style={{ maxHeight: "none" }}>
            {resultado.texto}
          </div>

          {resultado.cambios.length > 0 && (
            <>
              <h3 style={{ marginTop: "1.5rem" }}>Cambios aplicados ({resultado.cambios.length})</h3>
              {resultado.cambios.map((c) => (
                <div className="item" key={c.tipoHallazgo === "explicacion" ? c.explicacionId : c.pasajeId}>
                  <div className="item-label">
                    <span className="badge">{c.tipoHallazgo === "explicacion" ? c.explicacionId : c.pasajeId}</span>
                    <span className="badge">
                      {c.tipoHallazgo === "explicacion"
                        ? ETIQUETAS_VEREDICTO[c.veredicto] ?? c.veredicto
                        : ETIQUETAS_MECANISMO[c.mecanismo] ?? c.mecanismo}
                    </span>
                  </div>
                  <div className="item-label">
                    <span>Antes</span>
                  </div>
                  <p className="quote">{c.citaOriginal}</p>
                  <div className="item-label">
                    <span>Después</span>
                  </div>
                  <p className="quote">{c.textoAplicado}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
