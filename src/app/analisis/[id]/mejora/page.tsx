"use client";

import { use, useEffect, useState } from "react";
import { Loader } from "@/components/Loader";
import { ETIQUETAS_VEREDICTO } from "@/lib/etiquetas";
import type { MejoraSesion, IntentoMejora } from "@/lib/types";

type ExplicacionMejorable = {
  id: string;
  cita: string;
  mecanismoGeneral: string;
  razonFragil: string;
  sesion: MejoraSesion | null;
};

type Cupo = { desbloqueado: boolean; textosUsados: number; limite: number } | null;

const MAX_INTENTOS = 5;

const MENSAJES_EVALUAR = [
  "Identificando qué es fijo y qué es variable en tu redacción...",
  "Generando sustituciones dentro del mismo dominio...",
  "Poniendo a prueba tu fragmento...",
  "Redactando la nota...",
];

// Mismo patrón que en nuevo/page.tsx: Evaluar responde con Server-Sent Events (heartbeat + un evento final)
// porque encadena hasta 4 llamadas a Claude — puede tardar más que una respuesta JSON directa sin cortarse.
async function callApiStream<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Error inesperado.");
  }
  if (!res.body) {
    throw new Error("El servidor no devolvió una respuesta.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const payload = JSON.parse(dataLine.slice(5).trim());
      if (payload.error) throw new Error(payload.error);
      return payload as T;
    }
  }

  throw new Error("La conexión se cerró antes de recibir el resultado completo.");
}

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Error inesperado.");
  return data as T;
}

function textoInicialDe(e: ExplicacionMejorable): string {
  const intentos = e.sesion?.intentos ?? [];
  // El campo de edición arranca con el último intento propuesto, no con la cita original — para seguir
  // afinando el propio intento en vez de reescribir desde cero cada vez que se reabre la sesión.
  return intentos.length > 0 ? intentos[intentos.length - 1].texto : e.cita;
}

export default function MejoraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: analisisId } = use(params);

  const [explicaciones, setExplicaciones] = useState<ExplicacionMejorable[] | null>(null);
  const [cupo, setCupo] = useState<Cupo>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [evaluando, setEvaluando] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<string | null>(null);

  function cargar() {
    return fetch(`/api/analisis/${analisisId}/mejora`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        const lista = data.explicaciones as ExplicacionMejorable[];
        setExplicaciones(lista);
        setCupo(data.cupo);
        setTextos((prev) => {
          const next = { ...prev };
          for (const e of lista) {
            if (!(e.id in next)) next[e.id] = textoInicialDe(e);
          }
          return next;
        });
        setActiveId((prev) => prev ?? lista[0]?.id ?? null);
      })
      .catch(() => setError("No se pudo cargar Mejora para este análisis."));
  }

  useEffect(() => {
    cargar().finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analisisId]);

  const activa = explicaciones?.find((e) => e.id === activeId) ?? null;
  const intentosActivos = activa?.sesion?.intentos.length ?? 0;
  const cupoAgotadoParaTextoNuevo = Boolean(cupo && !cupo.desbloqueado && cupo.textosUsados >= cupo.limite);

  async function evaluar() {
    if (!activa) return;
    const texto = textos[activa.id]?.trim();
    if (!texto) return;

    setError(null);
    setEvaluando(activa.id);
    try {
      const data = await callApiStream<{ sesion: MejoraSesion }>(
        `/api/analisis/${analisisId}/mejora/${activa.id}/evaluar`,
        { texto }
      );
      setExplicaciones((prev) =>
        prev ? prev.map((e) => (e.id === activa.id ? { ...e, sesion: data.sesion } : e)) : prev
      );
      // Este clic pudo haber gastado un cupo de texto nuevo — refresca el estado del cupo.
      fetch(`/api/analisis/${analisisId}/mejora`)
        .then((res) => res.json())
        .then((d) => {
          if (!d.error) setCupo(d.cupo);
        })
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setEvaluando(null);
    }
  }

  async function aplicar(explicacionId: string, intentoId: string) {
    setError(null);
    setAplicando(intentoId);
    try {
      const data = await callApi<{ sesion: MejoraSesion }>(
        `/api/analisis/${analisisId}/mejora/${explicacionId}/aplicar`,
        { intentoId }
      );
      setExplicaciones((prev) =>
        prev ? prev.map((e) => (e.id === explicacionId ? { ...e, sesion: data.sesion } : e)) : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setAplicando(null);
    }
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: "1rem" }}>Mejora</h1>

      {error && <div className="error-banner">{error}</div>}
      {cargando && <p className="loading">Cargando explicaciones mejorables...</p>}

      {!cargando && explicaciones && explicaciones.length === 0 && (
        <p className="loading">No hay explicaciones con resultado Frágil pendientes en este análisis.</p>
      )}

      {!cargando && explicaciones && explicaciones.length > 0 && (
        <div className="card">
          {cupo && (
            <p className="item-label" style={{ marginBottom: "1rem" }}>
              <span>
                Cupo semanal de Mejora: {cupo.textosUsados}/{cupo.limite} textos usados
                {cupo.desbloqueado ? " (este texto ya está desbloqueado)" : ""}.
              </span>
            </p>
          )}

          <div className="mejora-tabs">
            {explicaciones.map((e) => {
              const aplicadoId = e.sesion?.aplicadoIntentoId;
              const intentoAplicado = aplicadoId ? e.sesion?.intentos.find((i) => i.id === aplicadoId) : null;
              const confirmadoFirme = intentoAplicado?.veredicto === "DificilDeVariar";
              return (
                <button
                  key={e.id}
                  className={`mejora-tab${e.id === activeId ? " activa" : ""}`}
                  onClick={() => setActiveId(e.id)}
                >
                  {e.id}
                  {aplicadoId && (
                    <span className={`mejora-tab-marca ${confirmadoFirme ? "confirmada" : "sin-confirmar"}`}>
                      {confirmadoFirme ? "✓" : "●"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activa && (
            <div>
              <div className="item-label">
                <span>Mecanismo general (fijo)</span>
              </div>
              <p className="quote">{activa.mecanismoGeneral}</p>

              <div className="item-label" style={{ marginTop: "0.75rem" }}>
                <span>Por qué salió Frágil</span>
              </div>
              <p className="quote">{activa.razonFragil}</p>

              <div className="item-label" style={{ marginTop: "1rem" }}>
                <span>Tu reformulación de este fragmento</span>
              </div>
              <textarea
                value={textos[activa.id] ?? ""}
                disabled={evaluando === activa.id || intentosActivos >= MAX_INTENTOS}
                onChange={(ev) => setTextos((prev) => ({ ...prev, [activa.id]: ev.target.value }))}
                rows={4}
              />

              {evaluando === activa.id ? (
                <Loader messages={MENSAJES_EVALUAR} />
              ) : (
                <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span className="loading">
                    Intento {Math.min(intentosActivos + 1, MAX_INTENTOS)} de {MAX_INTENTOS}
                  </span>
                  <button
                    className="primary"
                    disabled={
                      intentosActivos >= MAX_INTENTOS ||
                      !textos[activa.id]?.trim() ||
                      (cupoAgotadoParaTextoNuevo && !cupo?.desbloqueado)
                    }
                    onClick={evaluar}
                  >
                    Evaluar
                  </button>
                </div>
              )}
              {intentosActivos >= MAX_INTENTOS && (
                <p className="warning-note">Ya alcanzaste el máximo de {MAX_INTENTOS} intentos para esta explicación.</p>
              )}
              {cupoAgotadoParaTextoNuevo && !cupo?.desbloqueado && (
                <p className="warning-note">
                  Alcanzaste tu cupo de {cupo?.limite} textos por semana para Mejora. El cupo se reinicia el próximo lunes.
                </p>
              )}

              {activa.sesion && activa.sesion.intentos.length > 0 && (
                <>
                  <h3 style={{ marginTop: "1.5rem" }}>Historial de intentos</h3>
                  {[...activa.sesion.intentos].reverse().map((intento: IntentoMejora) => {
                    const aplicado = activa.sesion?.aplicadoIntentoId === intento.id;
                    return (
                      <div key={intento.id} className={`mejora-intento${aplicado ? " aplicado" : ""}`}>
                        <div className="item-label">
                          <span className="badge">{intento.id}</span>
                          <span className="badge">{ETIQUETAS_VEREDICTO[intento.veredicto] ?? intento.veredicto}</span>
                          {aplicado && (
                            <span className="badge">
                              {intento.veredicto === "DificilDeVariar"
                                ? "Aplicado — confirmado Firme"
                                : "Aplicado — sin llegar a Firme"}
                            </span>
                          )}
                        </div>
                        <p className="quote">{intento.texto}</p>
                        <p style={{ fontSize: "0.9rem" }}>{intento.notaMentor}</p>
                        <div className="actions">
                          <button
                            disabled={aplicado || aplicando === intento.id}
                            onClick={() => aplicar(activa.id, intento.id)}
                          >
                            {aplicado ? "Aplicado" : aplicando === intento.id ? "Aplicando..." : "Aplicar este cambio"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
