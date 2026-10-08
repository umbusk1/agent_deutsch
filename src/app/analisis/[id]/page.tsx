"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalisisGuardado } from "@/lib/analisis";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function VerAnalisis({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [registro, setRegistro] = useState<AnalisisGuardado | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Solo el autor puede crear una versión nueva (el servidor lo vuelve a comprobar); acá solo se decide si se
  // muestra el botón.
  const [usuarioActual, setUsuarioActual] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => res.json())
      .then((data) => setUsuarioActual(data.username ?? null))
      .catch(() => setUsuarioActual(null));
  }, []);

  useEffect(() => {
    fetch(`/api/analisis/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setRegistro(data);
      })
      .catch(() => setError("No se pudo cargar el análisis."));
  }, [id]);

  return (
    <div className="container">
      {error && <div className="error-banner">{error}</div>}
      {!registro && !error && <p className="loading">Cargando análisis...</p>}

      {registro && (
        <div className="card">
          <h2>{registro.metaTitulo || "(sin título)"}</h2>
          <p className="quote" style={{ marginBottom: "1rem" }}>
            {[registro.metaAutor, registro.metaMedio, registro.metaFecha].filter(Boolean).join(" · ") ||
              "Sin metadatos"}
          </p>
          <div className="report-preview" style={{ maxHeight: "none" }}>
            {registro.reporte}
          </div>
          <div className="actions">
            {registro.texto && registro.usuario === usuarioActual && (
              <button onClick={() => router.push(`/nuevo?version=${registro.id}`)}>
                Editar y volver a analizar
              </button>
            )}
            {registro.versionAnteriorId && (
              <button onClick={() => router.push(`/analisis/${registro.id}/version`)}>
                Ver qué cambió respecto a la versión anterior
              </button>
            )}
            <button
              onClick={() =>
                download(
                  `reporte-${registro.id}.md`,
                  `${[registro.metaFecha, registro.metaAutor, registro.metaMedio, registro.metaTitulo]
                    .filter(Boolean)
                    .join("\n")}\n\n---\n\n${registro.reporte}`
                )
              }
            >
              Descargar reporte.md
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
