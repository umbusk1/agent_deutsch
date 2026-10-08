"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalisisGuardado } from "@/lib/analisis";
import type { CambioVersion, ComparacionVersiones, Explicacion } from "@/lib/types";
import { ETIQUETAS_CAMBIO_VERSION, ETIQUETAS_TRANSICION, ETIQUETAS_VEREDICTO } from "@/lib/etiquetas";

// Lee un stream SSE de un solo evento final (mismo formato que usan las demás rutas largas).
async function leerSse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Error inesperado.");
  }
  if (!res.body) throw new Error("El servidor no devolvió una respuesta.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const linea = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!linea) continue; // heartbeat
      const payload = JSON.parse(linea.slice(5).trim());
      if (payload.error) throw new Error(payload.error);
      return payload as T;
    }
  }
  throw new Error("El servidor terminó la conexión sin enviar ningún resultado. Intenta de nuevo.");
}

function CitaLinea({ etiqueta, cita }: { etiqueta: string; cita: CambioVersion["citaAnterior"] }) {
  if (cita.vacia) return null;
  return (
    <>
      <div className="item-label">
        <span>{etiqueta}</span>
        {cita.valida === false && <span className="badge">No se pudo verificar esta cita en el texto</span>}
      </div>
      <p className="quote">{cita.texto}</p>
    </>
  );
}

export default function VersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [nuevo, setNuevo] = useState<AnalisisGuardado | null>(null);
  const [anterior, setAnterior] = useState<AnalisisGuardado | null>(null);
  const [comparacion, setComparacion] = useState<ComparacionVersiones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparando, setComparando] = useState(false);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/analisis/${id}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setNuevo(data);
        if (!data.versionAnteriorId) throw new Error("Este análisis no es una versión de otro análisis.");
        const resAnt = await fetch(`/api/analisis/${data.versionAnteriorId}`);
        const dataAnt = await resAnt.json();
        if (dataAnt.error) throw new Error(dataAnt.error);
        setAnterior(dataAnt);
        // Si ya se comparó antes, se muestra sin gastar nada; si no (404), se ofrece el botón.
        const resComp = await fetch(`/api/analisis/${id}/version/comparar`);
        if (resComp.ok) setComparacion(await resComp.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar la versión.");
      } finally {
        setCargado(true);
      }
    })();
  }, [id]);

  async function comparar() {
    setComparando(true);
    setError(null);
    try {
      const res = await fetch(`/api/analisis/${id}/version/comparar`, { method: "POST" });
      setComparacion(await leerSse<ComparacionVersiones>(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setComparando(false);
    }
  }

  function explicacion(analisis: AnalisisGuardado | null, eid: string | null): Explicacion | undefined {
    return eid ? analisis?.explicaciones?.find((e) => e.id === eid) : undefined;
  }

  return (
    <div className="container">
      <h1 style={{ marginBottom: "0.5rem" }}>
        {nuevo?.metaTitulo ?? "Versión"}
        {nuevo?.versionNumero ? ` — versión ${nuevo.versionNumero}` : ""}
      </h1>
      {error && <div className="error-banner">{error}</div>}
      {!cargado && <p className="loading">Cargando...</p>}

      {cargado && nuevo && anterior && !comparacion && (
        <div className="card">
          <h2>Comparar con la versión anterior</h2>
          <p style={{ marginBottom: "1rem" }}>
            Esta versión ya fue analizada. Falta compararla con la anterior para ver qué cambió y qué pasó con cada
            explicación. Son dos llamadas al modelo, y la comparación queda guardada: no se vuelve a gastar al
            reabrir la página.
          </p>
          <div className="actions">
            <button className="primary" disabled={comparando} onClick={comparar}>
              {comparando ? "Comparando..." : "Comparar con la versión anterior"}
            </button>
          </div>
        </div>
      )}

      {comparacion && (
        <>
          <div className="card">
            <h2>Qué cambió en el texto</h2>
            {comparacion.cambios.length === 0 ? (
              <p>No se detectaron cambios de fondo entre las dos versiones.</p>
            ) : (
              comparacion.cambios.map((c, i) => (
                <div className="item" key={i}>
                  <div className="item-label">
                    <span className="badge">{ETIQUETAS_CAMBIO_VERSION[c.tipo]}</span>
                  </div>
                  <CitaLinea etiqueta="Antes" cita={c.citaAnterior} />
                  <CitaLinea etiqueta="Ahora" cita={c.citaNueva} />
                  <p>{c.comentario}</p>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h2>Qué pasó con cada explicación</h2>
            {comparacion.cambioElProblema && (
              <p className="warning-note">
                En esta versión cambió el problema que plantea el texto. Por eso las explicaciones no se comparan
                una a una como Frágil o Firme: se muestran los resultados lado a lado, sin decir cuál es mejor.
              </p>
            )}
            <p className="loading" style={{ marginBottom: "0.75rem" }}>
              «Firme» no quiere decir que la explicación sea verdadera: solo que todavía no se ha podido cambiar sin
              que deje de explicar.
            </p>
            {comparacion.transiciones.length === 0 && <p>La versión nueva no tiene explicaciones analizadas.</p>}
            {comparacion.transiciones.map((t) => {
              const eNueva = explicacion(nuevo, t.explicacionNuevaId);
              const eAnt = explicacion(anterior, t.explicacionAnteriorId);
              return (
                <div className="item" key={t.explicacionNuevaId}>
                  <div className="item-label">
                    <span className="badge">{t.explicacionNuevaId}</span>
                    <span className="badge">{ETIQUETAS_TRANSICION[t.etiqueta]}</span>
                    {t.explicacionAnteriorId && (
                      <span>
                        Antes ({t.explicacionAnteriorId}):{" "}
                        {t.veredictoAnterior ? ETIQUETAS_VEREDICTO[t.veredictoAnterior] : "sin resultado"} · Ahora:{" "}
                        {t.veredictoNuevo ? ETIQUETAS_VEREDICTO[t.veredictoNuevo] : "sin resultado"}
                      </span>
                    )}
                    {!t.explicacionAnteriorId && (
                      <span>
                        Ahora: {t.veredictoNuevo ? ETIQUETAS_VEREDICTO[t.veredictoNuevo] : "sin resultado"}
                      </span>
                    )}
                  </div>
                  {eNueva && <p className="quote">{eNueva.resumen}</p>}
                  {eAnt && (
                    <p className="quote" style={{ opacity: 0.8 }}>
                      Antes: {eAnt.resumen}
                    </p>
                  )}
                  {t.razonPareja && <p className="loading">{t.razonPareja}</p>}
                </div>
              );
            })}
            {comparacion.explicacionesAnterioresSinPareja.length > 0 && (
              <>
                <h3 style={{ marginTop: "1rem" }}>Explicaciones de la versión anterior sin pareja en la nueva</h3>
                {comparacion.explicacionesAnterioresSinPareja.map((eid) => {
                  const e = explicacion(anterior, eid);
                  return (
                    <div className="item" key={eid}>
                      <div className="item-label">
                        <span className="badge">{eid}</span>
                      </div>
                      {e && <p className="quote">{e.resumen}</p>}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div className="actions">
            <button onClick={() => router.push(`/analisis/${comparacion.analisisAnteriorId}`)}>
              Ver la versión anterior
            </button>
            <button onClick={() => router.push(`/analisis/${comparacion.analisisNuevoId}`)}>
              Ver el reporte de esta versión
            </button>
            <button onClick={() => router.push(`/nuevo?version=${comparacion.analisisNuevoId}`)}>
              Editar esta versión y volver a analizar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
