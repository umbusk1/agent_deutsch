"use client";

import { use, useEffect, useState } from "react";
import { Loader } from "@/components/Loader";
import { ETIQUETAS_VEREDICTO, ETIQUETAS_MECANISMO } from "@/lib/etiquetas";
import type { MejoraSesionExplicacion, MejoraSesionPasaje, IntentoMejoraExplicacion, IntentoMejoraPasaje } from "@/lib/types";

type HallazgoExplicacion = {
  tipoHallazgo: "explicacion";
  id: string;
  cita: string;
  mecanismoGeneral: string;
  razonFragil: string;
  sesion: MejoraSesionExplicacion | null;
};

type HallazgoPasaje = {
  tipoHallazgo: "pasaje";
  id: string;
  cita: string;
  tecnicasOriginales: string[];
  razonDespojo: string;
  sesion: MejoraSesionPasaje | null;
};

type Hallazgo = HallazgoExplicacion | HallazgoPasaje;

type Cupo = { desbloqueado: boolean; textosUsados: number; limite: number; unlimited: boolean } | null;

// Parametrizado por tipo — Explicación tiene el mecanismo de sustitución completo detrás, Pasaje solo
// re-clasifica con el test de despojo, así que su tope es más chico. Duplicado acá (no importado de
// @/lib/mejora) para no arrastrar el cliente de Redis a un bundle de cliente — MANTENER EN SINCRONÍA A MANO
// con MAX_INTENTOS_EXPLICACION/MAX_INTENTOS_PASAJE en mejora.ts; no hay ninguna otra alarma si se desincroniza
// (ya pasó una vez: el server subió a 4 y esta copia se quedó en 3, bloqueando la UI de más).
const MAX_INTENTOS: Record<Hallazgo["tipoHallazgo"], number> = { explicacion: 5, pasaje: 5 };

const MENSAJES_EVALUAR_EXPLICACION = [
  "Identificando qué es fijo y qué es variable en tu redacción...",
  "Generando sustituciones dentro del mismo dominio...",
  "Poniendo a prueba tu fragmento...",
  "Redactando la nota...",
];

const MENSAJES_EVALUAR_PASAJE = [
  "Despojando el fragmento de su envoltorio retórico...",
  "Evaluando si queda una afirmación sustantiva en pie...",
  "Redactando la nota...",
];

// Mismo patrón que en nuevo/page.tsx: Evaluar responde con Server-Sent Events (heartbeat + un evento final)
// porque encadena varias llamadas a Claude — puede tardar más que una respuesta JSON directa sin cortarse.
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

function textoInicialDe(h: Hallazgo): string {
  const intentos = h.sesion?.intentos ?? [];
  // El campo de edición arranca con el último intento propuesto, no con la cita original — para seguir
  // afinando el propio intento en vez de reescribir desde cero cada vez que se reabre la sesión.
  return intentos.length > 0 ? intentos[intentos.length - 1].texto : h.cita;
}

function rutaEvaluar(analisisId: string, h: Hallazgo): string {
  return h.tipoHallazgo === "explicacion"
    ? `/api/analisis/${analisisId}/mejora/${h.id}/evaluar`
    : `/api/analisis/${analisisId}/mejora/pasaje/${h.id}/evaluar`;
}

function rutaAplicar(analisisId: string, h: Hallazgo): string {
  return h.tipoHallazgo === "explicacion"
    ? `/api/analisis/${analisisId}/mejora/${h.id}/aplicar`
    : `/api/analisis/${analisisId}/mejora/pasaje/${h.id}/aplicar`;
}

export default function MejoraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: analisisId } = use(params);

  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null);
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
        const lista = data.hallazgos as Hallazgo[];
        setHallazgos(lista);
        setCupo(data.cupo);
        setTextos((prev) => {
          const next = { ...prev };
          for (const h of lista) {
            if (!(h.id in next)) next[h.id] = textoInicialDe(h);
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

  const activa = hallazgos?.find((h) => h.id === activeId) ?? null;
  const intentosActivos = activa?.sesion?.intentos.length ?? 0;
  const maxIntentosActiva = activa ? MAX_INTENTOS[activa.tipoHallazgo] : 0;
  const cupoAgotadoParaTextoNuevo = Boolean(
    cupo && !cupo.unlimited && !cupo.desbloqueado && cupo.textosUsados >= cupo.limite
  );

  async function evaluar() {
    if (!activa) return;
    const texto = textos[activa.id]?.trim();
    if (!texto) return;

    setError(null);
    setEvaluando(activa.id);
    try {
      const data = await callApiStream<{ sesion: MejoraSesionExplicacion | MejoraSesionPasaje }>(
        rutaEvaluar(analisisId, activa),
        { texto }
      );
      setHallazgos((prev) =>
        prev ? prev.map((h) => (h.id === activa.id ? ({ ...h, sesion: data.sesion } as Hallazgo) : h)) : prev
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

  async function aplicar(intentoId: string) {
    if (!activa) return;
    setError(null);
    setAplicando(intentoId);
    try {
      const data = await callApi<{ sesion: MejoraSesionExplicacion | MejoraSesionPasaje }>(
        rutaAplicar(analisisId, activa),
        { intentoId }
      );
      setHallazgos((prev) =>
        prev ? prev.map((h) => (h.id === activa.id ? ({ ...h, sesion: data.sesion } as Hallazgo) : h)) : prev
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
      {cargando && <p className="loading">Cargando lo que se puede mejorar...</p>}

      {!cargando && hallazgos && hallazgos.length === 0 && (
        <p className="loading">
          No hay explicaciones Frágiles ni pasajes que cierren el argumento pendientes en este análisis.
        </p>
      )}

      {!cargando && hallazgos && hallazgos.length > 0 && (
        <div className="card">
          {cupo && (
            <p className="item-label" style={{ marginBottom: "1rem" }}>
              <span>
                {cupo.unlimited
                  ? "Mejora ilimitada (admin)"
                  : `Cupo semanal de Mejora: ${cupo.textosUsados}/${cupo.limite} textos usados${
                      cupo.desbloqueado ? " (este texto ya está desbloqueado)" : ""
                    }.`}
              </span>
            </p>
          )}

          <div className="mejora-tabs">
            {hallazgos.map((h) => {
              const aplicadoId = h.sesion?.aplicadoIntentoId;
              const intentoAplicado = aplicadoId ? h.sesion?.intentos.find((i) => i.id === aplicadoId) : null;
              const confirmado =
                h.tipoHallazgo === "explicacion"
                  ? (intentoAplicado as IntentoMejoraExplicacion | undefined)?.veredicto === "DificilDeVariar"
                  : (intentoAplicado as IntentoMejoraPasaje | undefined)?.mecanismo === "Racional";
              return (
                <button
                  key={h.id}
                  className={`mejora-tab${h.id === activeId ? " activa" : ""}`}
                  onClick={() => setActiveId(h.id)}
                >
                  {h.id}
                  {aplicadoId && (
                    <span className={`mejora-tab-marca ${confirmado ? "confirmada" : "sin-confirmar"}`}>
                      {confirmado ? "✓" : "●"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activa && (
            <div>
              {activa.tipoHallazgo === "explicacion" ? (
                <>
                  <div className="item-label">
                    <span>Mecanismo general (fijo)</span>
                  </div>
                  <p className="quote">{activa.mecanismoGeneral}</p>

                  <div className="item-label" style={{ marginTop: "0.75rem" }}>
                    <span>Por qué salió Frágil</span>
                  </div>
                  <p className="quote">{activa.razonFragil}</p>
                </>
              ) : (
                <>
                  <div className="item-label">
                    <span>Técnica identificada (fija)</span>
                  </div>
                  <p className="quote">{activa.tecnicasOriginales.join(", ") || "(ninguna registrada)"}</p>

                  <div className="item-label" style={{ marginTop: "0.75rem" }}>
                    <span>Por qué no sobrevivió el despojo</span>
                  </div>
                  <p className="quote">{activa.razonDespojo}</p>
                </>
              )}

              <div className="item-label" style={{ marginTop: "1rem" }}>
                <span>Tu reformulación de este fragmento</span>
              </div>
              <textarea
                value={textos[activa.id] ?? ""}
                disabled={evaluando === activa.id || intentosActivos >= maxIntentosActiva}
                onChange={(ev) => setTextos((prev) => ({ ...prev, [activa.id]: ev.target.value }))}
                rows={4}
              />

              {evaluando === activa.id ? (
                <Loader
                  messages={
                    activa.tipoHallazgo === "explicacion" ? MENSAJES_EVALUAR_EXPLICACION : MENSAJES_EVALUAR_PASAJE
                  }
                />
              ) : (
                <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span className="loading">
                    Intento {Math.min(intentosActivos + 1, maxIntentosActiva)} de {maxIntentosActiva}
                  </span>
                  <button
                    className="primary"
                    disabled={
                      intentosActivos >= maxIntentosActiva ||
                      !textos[activa.id]?.trim() ||
                      (cupoAgotadoParaTextoNuevo && !cupo?.desbloqueado)
                    }
                    onClick={evaluar}
                  >
                    Evaluar
                  </button>
                </div>
              )}
              {intentosActivos >= maxIntentosActiva && (
                <p className="warning-note">
                  Ya alcanzaste el máximo de {maxIntentosActiva} intentos para este hallazgo.
                </p>
              )}
              {cupoAgotadoParaTextoNuevo && !cupo?.desbloqueado && (
                <p className="warning-note">
                  Alcanzaste tu cupo de {cupo?.limite} textos por semana para Mejora. El cupo se reinicia el próximo lunes.
                </p>
              )}

              {activa.sesion && activa.sesion.intentos.length > 0 && (
                <>
                  <h3 style={{ marginTop: "1.5rem" }}>Historial de intentos</h3>
                  {activa.tipoHallazgo === "explicacion"
                    ? [...activa.sesion.intentos].reverse().map((intento) => {
                        const aplicado = activa.sesion?.aplicadoIntentoId === intento.id;
                        return (
                          <div key={intento.id} className={`mejora-intento${aplicado ? " aplicado" : ""}`}>
                            <div className="item-label">
                              <span className="badge">{intento.id}</span>
                              <span className="badge">
                                {ETIQUETAS_VEREDICTO[intento.veredicto] ?? intento.veredicto}
                              </span>
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
                              <button disabled={aplicado || aplicando === intento.id} onClick={() => aplicar(intento.id)}>
                                {aplicado ? "Aplicado" : aplicando === intento.id ? "Aplicando..." : "Aplicar este cambio"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    : [...activa.sesion.intentos].reverse().map((intento) => {
                        const aplicado = activa.sesion?.aplicadoIntentoId === intento.id;
                        return (
                          <div key={intento.id} className={`mejora-intento${aplicado ? " aplicado" : ""}`}>
                            <div className="item-label">
                              <span className="badge">{intento.id}</span>
                              <span className="badge">
                                {ETIQUETAS_MECANISMO[intento.mecanismo] ?? intento.mecanismo}
                              </span>
                              {aplicado && (
                                <span className="badge">
                                  {intento.mecanismo === "Racional"
                                    ? "Aplicado — confirmado: abre el argumento"
                                    : intento.mecanismo === "Mixto"
                                    ? "Aplicado — parcial: todavía no abre del todo el argumento"
                                    : "Aplicado — sin confirmar: sigue cerrando el argumento"}
                                </span>
                              )}
                            </div>
                            <p className="quote">{intento.texto}</p>
                            {intento.tecnicas.length > 0 && (
                              <p className="item-label" style={{ marginBottom: 0 }}>
                                <span>Técnicas detectadas: {intento.tecnicas.join(", ")}</span>
                              </p>
                            )}
                            <p style={{ fontSize: "0.9rem" }}>{intento.notaMentor}</p>
                            <div className="actions">
                              <button disabled={aplicado || aplicando === intento.id} onClick={() => aplicar(intento.id)}>
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
