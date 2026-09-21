"use client";

import { use, useEffect, useState } from "react";
import type { Comparacion } from "@/lib/types";
import type { AnalisisGuardado } from "@/lib/analisis";

export default function VerComparacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [comparacion, setComparacion] = useState<Comparacion | null>(null);
  const [analisisA, setAnalisisA] = useState<AnalisisGuardado | null>(null);
  const [analisisB, setAnalisisB] = useState<AnalisisGuardado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/comparacion/${id}`)
      .then((res) => res.json())
      .then(async (data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setComparacion(data);
        const [resA, resB] = await Promise.all([
          fetch(`/api/analisis/${data.analisisAId}`),
          fetch(`/api/analisis/${data.analisisBId}`),
        ]);
        const [dataA, dataB] = await Promise.all([resA.json(), resB.json()]);
        if (!dataA.error) setAnalisisA(dataA);
        if (!dataB.error) setAnalisisB(dataB);
      })
      .catch(() => setError("No se pudo cargar la comparación."));
  }, [id]);

  return (
    <div className="container">
      <p className="loading" style={{ marginBottom: "1.5rem" }}>
        Comparación entre dos análisis — estructura y rigor, no cuál describe mejor la realidad.
      </p>

      {error && <div className="error-banner">{error}</div>}
      {!comparacion && !error && <p className="loading">Cargando comparación...</p>}

      {comparacion && (
        <>
          <div className="card">
            <h2>¿Resuelven el mismo problema?</h2>
            <p className="badge" style={{ marginBottom: "0.5rem" }}>
              {comparacion.mismoProblema ? "Mismo problema" : "Problemas distintos"}
            </p>
            <p>{comparacion.justificacionProblema}</p>
          </div>

          <div className="card">
            <h3>{analisisA?.metaTitulo || "Análisis A"}</h3>
            <p className="badge" style={{ marginBottom: "0.5rem" }}>
              Puente {comparacion.firmezaPuenteA.firme ? "firme" : "débil"}
            </p>
            <p>{comparacion.firmezaPuenteA.justificacion}</p>
          </div>

          <div className="card">
            <h3>{analisisB?.metaTitulo || "Análisis B"}</h3>
            <p className="badge" style={{ marginBottom: "0.5rem" }}>
              Puente {comparacion.firmezaPuenteB.firme ? "firme" : "débil"}
            </p>
            <p>{comparacion.firmezaPuenteB.justificacion}</p>
          </div>

          <div className="card">
            <h2>Síntesis</h2>
            <p>{comparacion.sintesis}</p>
          </div>
        </>
      )}
    </div>
  );
}
