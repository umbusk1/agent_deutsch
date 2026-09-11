"use client";

import { useEffect, useState } from "react";
import type {
  Explicacion,
  Descartada,
  Problema,
  VarianteAceptada,
  VarianteDescartada,
  Veredicto,
  ProblemaNuevo,
  Relacion,
  PasajePersuasivo,
  Alcance,
} from "@/lib/types";

const STEP_LABELS = [
  "Texto",
  "Extracción",
  "Persuasión",
  "Problemas",
  "Variantes",
  "Veredictos",
  "Preguntas nuevas",
  "Relaciones",
  "Reporte",
];

const ACCENT_MAP: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
  Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ü: "u", Ñ: "n",
};

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metaFecha, setMetaFecha] = useState("");
  const [metaAutor, setMetaAutor] = useState("");
  const [metaMedio, setMetaMedio] = useState("");
  const [metaTitulo, setMetaTitulo] = useState("");

  const [quota, setQuota] = useState<{
    unlimited: boolean;
    limit?: number;
    remaining?: number;
  } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setQuota(data);
      })
      .catch(() => {
        // Sin cuota visible, el límite real igual se aplica del lado del servidor.
      });
  }, []);

  const [explicaciones, setExplicaciones] = useState<Explicacion[]>([]);
  const [descartadas, setDescartadas] = useState<Descartada[]>([]);
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set());

  const [pasajesPersuasivos, setPasajesPersuasivos] = useState<PasajePersuasivo[]>([]);
  const [pasajesExcluidos, setPasajesExcluidos] = useState<Set<string>>(new Set());

  const [problemas, setProblemas] = useState<Problema[]>([]);
  const [problemasExcluidos, setProblemasExcluidos] = useState<Set<string>>(new Set());

  const [variantesAceptadas, setVariantesAceptadas] = useState<VarianteAceptada[]>([]);
  const [variantesDescartadas, setVariantesDescartadas] = useState<VarianteDescartada[]>([]);
  const [variantesExcluidas, setVariantesExcluidas] = useState<Set<string>>(new Set());

  const [veredictos, setVeredictos] = useState<Veredicto[]>([]);

  const [problemasNuevos, setProblemasNuevos] = useState<ProblemaNuevo[]>([]);
  const [problemasNuevosExcluidos, setProblemasNuevosExcluidos] = useState<Set<string>>(new Set());
  const [alcances, setAlcances] = useState<Alcance[]>([]);

  const [relaciones, setRelaciones] = useState<Relacion[]>([]);
  const [reporte, setReporte] = useState("");

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

  // El Paso 7 responde con Server-Sent Events (heartbeats + un evento final) en vez de JSON directo,
  // para mantener la conexión viva durante las llamadas largas a Claude. Ver /api/step7/route.ts.
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
        if (!dataLine) continue; // heartbeat ": ping" u otro comentario, ignorar

        const payload = JSON.parse(dataLine.slice(5).trim());
        if (payload.error) throw new Error(payload.error);
        return payload as T;
      }
    }

    throw new Error("La conexión se cerró antes de recibir el reporte completo.");
  }

  function toggleSet(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function runStep1() {
    if (!texto.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ explicaciones: Explicacion[]; descartadas: Descartada[] }>(
        "/api/step1",
        { texto }
      );
      setExplicaciones(data.explicaciones);
      setDescartadas(data.descartadas);
      setExcluidas(new Set());
      // Invalida todo lo que dependía de una corrida anterior.
      setPasajesPersuasivos([]);
      setPasajesExcluidos(new Set());
      setProblemas([]);
      setVariantesAceptadas([]);
      setVariantesDescartadas([]);
      setVeredictos([]);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
      setStep(1);
      setFurthestStep(1);
      setQuota((prev) =>
        prev && !prev.unlimited && typeof prev.remaining === "number"
          ? { ...prev, remaining: Math.max(0, prev.remaining - 1) }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep1B() {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ pasajesPersuasivos: PasajePersuasivo[] }>("/api/step1b", { texto });
      setPasajesPersuasivos(data.pasajesPersuasivos);
      setPasajesExcluidos(new Set());
      setReporte("");
      setStep(2);
      setFurthestStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep2() {
    const activas = explicaciones.filter((e) => !excluidas.has(e.id));
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ problemas: Problema[] }>("/api/step2", {
        texto,
        explicaciones: activas,
      });
      const conProblema = activas.filter((e) =>
        data.problemas.some((p) => p.explicacionId === e.id)
      );
      setExplicaciones(conProblema);
      setProblemas(data.problemas.filter((p) => conProblema.some((e) => e.id === p.explicacionId)));
      setProblemasExcluidos(new Set());
      setVariantesAceptadas([]);
      setVariantesDescartadas([]);
      setVeredictos([]);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
      setStep(3);
      setFurthestStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep3() {
    const explicacionesActivas = explicaciones.filter((e) => !problemasExcluidos.has(e.id));
    const problemasActivos = problemas.filter((p) => !problemasExcluidos.has(p.explicacionId));
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{
        variantesAceptadas: VarianteAceptada[];
        variantesDescartadas: VarianteDescartada[];
      }>("/api/step3", { texto, explicaciones: explicacionesActivas, problemas: problemasActivos });
      setExplicaciones(explicacionesActivas);
      setProblemas(problemasActivos);
      setVariantesAceptadas(data.variantesAceptadas);
      setVariantesDescartadas(data.variantesDescartadas);
      setVariantesExcluidas(new Set());
      setVeredictos([]);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
      setStep(4);
      setFurthestStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep4() {
    const activas = variantesAceptadas.filter((v) => !variantesExcluidas.has(v.id));
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ veredictos: Veredicto[] }>("/api/step4", {
        texto,
        explicaciones,
        problemas,
        variantesAceptadas: activas,
      });
      setVariantesAceptadas(activas);
      setVeredictos(data.veredictos);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
      setStep(5);
      setFurthestStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep5() {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ problemasNuevos: ProblemaNuevo[]; alcances: Alcance[] }>("/api/step5", {
        texto,
        explicaciones,
        problemas,
        veredictos,
      });
      setProblemasNuevos(data.problemasNuevos);
      setProblemasNuevosExcluidos(new Set());
      setAlcances(data.alcances);
      setRelaciones([]);
      setReporte("");
      setStep(6);
      setFurthestStep(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep6() {
    const activos = problemasNuevos.filter((p) => !problemasNuevosExcluidos.has(p.id));
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ relaciones: Relacion[] }>("/api/step6", {
        explicaciones,
        problemas,
      });
      setProblemasNuevos(activos);
      setRelaciones(data.relaciones);
      setReporte("");
      setStep(7);
      setFurthestStep(7);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep7() {
    const pasajesActivos = pasajesPersuasivos.filter((p) => !pasajesExcluidos.has(p.id));
    setLoading(true);
    setError(null);
    try {
      const data = await callApiStream<{ reporte: string }>("/api/step7", {
        texto,
        explicaciones,
        problemas,
        veredictos,
        problemasNuevos,
        relaciones,
        pasajesPersuasivos: pasajesActivos,
        alcances,
      });
      setPasajesPersuasivos(pasajesActivos);
      setReporte(data.reporte);
      setStep(8);
      setFurthestStep(8);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  function slugify(value: string): string {
    return value
      .split("")
      .map((ch) => ACCENT_MAP[ch] ?? ch)
      .join("")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  function buildFilenameBase(): string {
    const parts = [metaFecha, metaAutor, metaMedio, metaTitulo].map(slugify).filter(Boolean);
    return parts.length > 0 ? parts.join("-") : "analisis";
  }

  function buildMetaHeader(): string {
    const lines: string[] = [];
    if (metaFecha.trim()) lines.push(`Fecha: ${metaFecha.trim()}`);
    if (metaAutor.trim()) lines.push(`Autor: ${metaAutor.trim()}`);
    if (metaMedio.trim()) lines.push(`Medio: ${metaMedio.trim()}`);
    if (metaTitulo.trim()) lines.push(`Título: ${metaTitulo.trim()}`);
    return lines.length > 0 ? lines.join("\n") + "\n\n---\n\n" : "";
  }

  function buildTripletas(): string {
    const lines: string[] = ["# Glosario", ""];
    for (const e of explicaciones) lines.push(`${e.id}: ${e.resumen}`);
    for (const e of explicaciones) lines.push(`${e.id} (mecanismo general): ${e.mecanismoGeneral}`);
    for (const p of problemas) lines.push(`${p.id}: ${p.enunciado}`);
    for (const v of variantesAceptadas) lines.push(`${v.id}: ${v.descripcion}`);
    for (const n of problemasNuevos) lines.push(`${n.id}: ${n.enunciado}`);
    for (const a of alcances) lines.push(`${a.explicacionId} (alcance): ${a.justificacion}`);
    for (const m of pasajesPersuasivos) lines.push(`${m.id}: ${m.cita}`);

    lines.push("", "# Tripletas", "");
    for (const m of pasajesPersuasivos) {
      lines.push(`${m.id} --usa_mecanismo--> ${m.mecanismo}`);
      for (const t of m.tecnicas) lines.push(`${m.id} --tecnica--> ${t}`);
    }
    for (const e of explicaciones) {
      const p = problemas.find((p) => p.explicacionId === e.id);
      if (p) lines.push(`${e.id} --resuelve--> ${p.id}`);
    }
    for (const v of variantesAceptadas) {
      lines.push(`${v.id} --es_variante_de--> ${v.explicacionId}`);
      const veredicto = veredictos.find((ve) => ve.explicacionId === v.explicacionId);
      const resultado = veredicto?.resultadosVariantes.find((r) => r.varianteId === v.id);
      const problema = problemas.find((p) => p.explicacionId === v.explicacionId);
      if (resultado && problema) {
        lines.push(`${v.id} --${resultado.resultado}--> ${problema.id}`);
      }
    }
    for (const ve of veredictos) {
      lines.push(`${ve.explicacionId} --tiene_veredicto--> ${ve.veredicto}`);
    }
    for (const a of alcances) {
      lines.push(`${a.explicacionId} --tiene_alcance--> ${a.tipo}`);
    }
    for (const n of problemasNuevos) {
      lines.push(`${n.explicacionId} --genera--> ${n.id}`);
      lines.push(`${n.id} --reconocido_por_autor--> ${n.reconocidoPorAutor}`);
    }
    for (const r of relaciones) {
      lines.push(`${r.explicacionAId} --${r.tipo}--> ${r.explicacionBId}`);
    }
    return lines.join("\n");
  }

  const wordCount = texto.trim() ? texto.trim().split(/\s+/).length : 0;

  return (
    <div className="container">
      <div className="header">
        <h1>Agente Deutsch</h1>
        <p>Análisis crítico de la calidad explicativa de un texto de opinión.</p>
      </div>

      <div className="steps-indicator">
        {STEP_LABELS.map((label, i) => {
          const reached = i <= furthestStep;
          const clickable = reached && i !== step && !loading;
          return (
            <button
              key={label}
              type="button"
              className={`step-dot ${i === step ? "active" : reached ? "done" : ""}`}
              disabled={!clickable}
              onClick={() => {
                setError(null);
                setStep(i);
              }}
            >
              {i}. {label}
            </button>
          );
        })}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {step === 0 && (
        <div className="card">
          <h2>Pega el texto de opinión a analizar</h2>
          <textarea
            className="big"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Pega aquí el artículo o ensayo..."
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.6rem",
              marginTop: "1rem",
            }}
          >
            <div>
              <div className="item-label">
                <span>Fecha del artículo (opcional)</span>
              </div>
              <input
                type="text"
                value={metaFecha}
                onChange={(e) => setMetaFecha(e.target.value)}
                placeholder="ej. 2026-09-06"
              />
            </div>
            <div>
              <div className="item-label">
                <span>Apellido del autor (opcional)</span>
              </div>
              <input
                type="text"
                value={metaAutor}
                onChange={(e) => setMetaAutor(e.target.value)}
                placeholder="ej. García"
              />
            </div>
            <div>
              <div className="item-label">
                <span>Medio (opcional)</span>
              </div>
              <input
                type="text"
                value={metaMedio}
                onChange={(e) => setMetaMedio(e.target.value)}
                placeholder="ej. El País"
              />
            </div>
            <div>
              <div className="item-label">
                <span>Título corto (opcional)</span>
              </div>
              <input
                type="text"
                value={metaTitulo}
                onChange={(e) => setMetaTitulo(e.target.value)}
                placeholder="ej. crisis-migratoria"
              />
            </div>
          </div>
          {quota && !quota.unlimited && (
            <p className="loading" style={{ marginTop: "0.75rem" }}>
              {quota.remaining === 0
                ? `Ya usaste tus ${quota.limit} análisis de esta semana. El cupo se reinicia el próximo lunes.`
                : `Te quedan ${quota.remaining} de ${quota.limit} análisis esta semana.`}
            </p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={loading || !texto.trim() || quota?.remaining === 0}
              onClick={() => setShowConfirm(true)}
            >
              Comenzar análisis
            </button>
          </div>

          {showConfirm && (
            <div className="card" style={{ marginTop: "1rem", borderColor: "var(--accent)" }}>
              <h3>Confirma antes de empezar</h3>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                Tu texto tiene aproximadamente <strong>{wordCount}</strong> palabras. El análisis
                funciona mejor con artículos de hasta ~1,900 palabras; con textos más largos puede
                tardar más y consumir más cuota de la API.
              </p>
              <p style={{ marginBottom: "1rem" }}>
                {quota && !quota.unlimited
                  ? `Te quedan ${quota.remaining} de ${quota.limit} análisis esta semana. Vas a usar uno con este texto — ¿es el que quieres analizar?`
                  : "Vas a iniciar un análisis con este texto — ¿es el que quieres analizar?"}
              </p>
              <div className="actions">
                <button onClick={() => setShowConfirm(false)}>Cancelar</button>
                <button
                  className="primary"
                  disabled={loading}
                  onClick={() => {
                    setShowConfirm(false);
                    runStep1();
                  }}
                >
                  {loading ? "Extrayendo..." : "Confirmar y analizar"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>Explicaciones candidatas</h2>
          {explicaciones.map((e) => (
            <div className="item" key={e.id}>
              <div className="item-label">
                <span className="badge">{e.id}</span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={excluidas.has(e.id)}
                    onChange={() => toggleSet(excluidas, e.id, setExcluidas)}
                  />
                  Excluir del análisis
                </label>
              </div>
              <div className="quote">&ldquo;{e.cita}&rdquo;</div>
              <div className="item-label" style={{ marginTop: "0.5rem" }}>
                <span>Mecanismo general (la regularidad universal que invoca, sin actores ni hechos de este caso)</span>
              </div>
              <textarea
                value={e.mecanismoGeneral}
                onChange={(ev) =>
                  setExplicaciones((prev) =>
                    prev.map((x) => (x.id === e.id ? { ...x, mecanismoGeneral: ev.target.value } : x))
                  )
                }
              />
              <div className="item-label" style={{ marginTop: "0.5rem" }}>
                <span>Aplicación específica (ese mecanismo aplicado a este caso concreto)</span>
              </div>
              <textarea
                value={e.resumen}
                onChange={(ev) =>
                  setExplicaciones((prev) =>
                    prev.map((x) => (x.id === e.id ? { ...x, resumen: ev.target.value } : x))
                  )
                }
              />
            </div>
          ))}

          {descartadas.length > 0 && (
            <div className="discarded-list">
              <h3>Descartado (no son explicaciones)</h3>
              {descartadas.map((d, i) => (
                <div className="item" key={i}>
                  <div className="quote">&ldquo;{d.cita}&rdquo;</div>
                  <div>
                    <span className="badge">{d.tipo}</span> {d.motivo}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep1B}>
              {loading ? "Analizando persuasión..." : "Continuar"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>Pasajes con mecanismo de persuasión</h2>
          <p className="loading" style={{ marginBottom: "1rem" }}>
            Lectura independiente del Paso 1: identifica pasajes que le piden al lector dejar de cuestionar
            una afirmación (por lealtad, urgencia, autoridad, tabú o vergüenza anticipada), y si esa carga
            reemplaza al argumento o solo lo acompaña.
          </p>
          {pasajesPersuasivos.length === 0 && (
            <p className="loading">No se encontraron pasajes con mecanismo de persuasión de este tipo.</p>
          )}
          {pasajesPersuasivos.map((m) => (
            <div className="item" key={m.id} style={{ opacity: pasajesExcluidos.has(m.id) ? 0.5 : 1 }}>
              <div className="item-label">
                <span className="badge">{m.id}</span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pasajesExcluidos.has(m.id)}
                    onChange={() => toggleSet(pasajesExcluidos, m.id, setPasajesExcluidos)}
                  />
                  Excluir del análisis
                </label>
              </div>
              <div className="quote">&ldquo;{m.cita}&rdquo;</div>
              <select
                value={m.mecanismo}
                disabled={pasajesExcluidos.has(m.id)}
                onChange={(ev) =>
                  setPasajesPersuasivos((prev) =>
                    prev.map((x) =>
                      x.id === m.id
                        ? { ...x, mecanismo: ev.target.value as PasajePersuasivo["mecanismo"] }
                        : x
                    )
                  )
                }
              >
                <option value="Racional">Racional</option>
                <option value="AntiRacional">AntiRacional</option>
              </select>
              <div className="item-label" style={{ marginTop: "0.5rem" }}>
                <span>Técnicas (una por línea)</span>
              </div>
              <textarea
                value={m.tecnicas.join("\n")}
                disabled={pasajesExcluidos.has(m.id)}
                onChange={(ev) =>
                  setPasajesPersuasivos((prev) =>
                    prev.map((x) =>
                      x.id === m.id
                        ? { ...x, tecnicas: ev.target.value.split("\n") }
                        : x
                    )
                  )
                }
              />
              <textarea
                value={m.justificacion}
                disabled={pasajesExcluidos.has(m.id)}
                onChange={(ev) =>
                  setPasajesPersuasivos((prev) =>
                    prev.map((x) => (x.id === m.id ? { ...x, justificacion: ev.target.value } : x))
                  )
                }
              />
            </div>
          ))}
          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep2}>
              {loading ? "Formulando problemas..." : "Continuar"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h2>Problema que resuelve cada explicación</h2>
          <p className="loading" style={{ marginBottom: "1rem" }}>
            Poda la lista si quieres quedarte solo con el problema principal, o con unos pocos relevantes:
            eliminar un problema también descarta su explicación del resto del análisis.
          </p>
          {problemas.map((p) => {
            const e = explicaciones.find((x) => x.id === p.explicacionId);
            return (
              <div className="item" key={p.id} style={{ opacity: problemasExcluidos.has(p.explicacionId) ? 0.5 : 1 }}>
                <div className="item-label">
                  <span className="badge">
                    {p.id} · {p.explicacionId}
                  </span>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={problemasExcluidos.has(p.explicacionId)}
                      onChange={() => toggleSet(problemasExcluidos, p.explicacionId, setProblemasExcluidos)}
                    />
                    Eliminar (descarta también la explicación)
                  </label>
                </div>
                {e && <div className="quote">&ldquo;{e.resumen}&rdquo;</div>}
                <textarea
                  value={p.enunciado}
                  disabled={problemasExcluidos.has(p.explicacionId)}
                  onChange={(ev) =>
                    setProblemas((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, enunciado: ev.target.value } : x))
                    )
                  }
                />
              </div>
            );
          })}
          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep3}>
              {loading ? "Generando variantes..." : "Continuar"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h2>Variantes por explicación</h2>
          {explicaciones.map((e) => {
            const aceptadas = variantesAceptadas.filter((v) => v.explicacionId === e.id);
            const descartadasE = variantesDescartadas.filter((v) => v.explicacionId === e.id);
            if (aceptadas.length === 0 && descartadasE.length === 0) return null;
            return (
              <div className="item" key={e.id}>
                <h3>
                  {e.id}: {e.resumen}
                </h3>
                {aceptadas.map((v) => (
                  <div key={v.id} style={{ marginBottom: "0.6rem" }}>
                    <div className="item-label">
                      <span className="badge">{v.id}</span>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={variantesExcluidas.has(v.id)}
                          onChange={() => toggleSet(variantesExcluidas, v.id, setVariantesExcluidas)}
                        />
                        Excluir
                      </label>
                    </div>
                    <textarea
                      value={v.descripcion}
                      onChange={(ev) =>
                        setVariantesAceptadas((prev) =>
                          prev.map((x) => (x.id === v.id ? { ...x, descripcion: ev.target.value } : x))
                        )
                      }
                    />
                  </div>
                ))}
                {descartadasE.length > 0 && (
                  <div className="discarded-list">
                    {descartadasE.map((d, i) => (
                      <div key={i}>
                        {d.descripcion} — <em>{d.motivo}</em>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep4}>
              {loading ? "Evaluando variantes..." : "Continuar"}
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card">
          <h2>Veredictos</h2>
          {veredictos.map((ve) => {
            const e = explicaciones.find((x) => x.id === ve.explicacionId);
            return (
              <div className="item" key={ve.explicacionId}>
                <h3>
                  {e?.id}: {e?.resumen}
                </h3>
                {ve.veredicto === "SinSustitutoGenuino" && (
                  <p className="warning-note">
                    El paso anterior no logró generar ninguna variante que compitiera genuinamente por el mismo
                    problema — esta explicación no fue puesta a prueba. No es lo mismo que &ldquo;difícil de
                    variar&rdquo;.
                  </p>
                )}
                {ve.resultadosVariantes.map((r) => {
                  const v = variantesAceptadas.find((x) => x.id === r.varianteId);
                  return (
                    <div key={r.varianteId} style={{ marginBottom: "0.4rem", fontSize: "0.85rem" }}>
                      <span className="badge">{r.resultado}</span> {v?.descripcion}
                      <div style={{ color: "var(--muted)" }}>{r.justificacion}</div>
                    </div>
                  );
                })}
                <div className="item-label" style={{ marginTop: "0.6rem" }}>
                  <span>Veredicto</span>
                </div>
                <select
                  value={ve.veredicto}
                  onChange={(ev) =>
                    setVeredictos((prev) =>
                      prev.map((x) =>
                        x.explicacionId === ve.explicacionId
                          ? { ...x, veredicto: ev.target.value as Veredicto["veredicto"] }
                          : x
                      )
                    )
                  }
                >
                  <option value="DificilDeVariar">DificilDeVariar</option>
                  <option value="FacilDeVariar">FacilDeVariar</option>
                  <option value="Mixta">Mixta</option>
                  <option value="SinSustitutoGenuino">SinSustitutoGenuino (no puesta a prueba)</option>
                </select>
                <textarea
                  value={ve.justificacion}
                  onChange={(ev) =>
                    setVeredictos((prev) =>
                      prev.map((x) =>
                        x.explicacionId === ve.explicacionId ? { ...x, justificacion: ev.target.value } : x
                      )
                    )
                  }
                />
              </div>
            );
          })}
          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep5}>
              {loading ? "Buscando preguntas nuevas..." : "Continuar"}
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="card">
          <h2>Preguntas nuevas que abren las explicaciones fuertes</h2>
          {problemasNuevos.length === 0 && <p className="loading">No se generaron preguntas nuevas.</p>}
          {problemasNuevos.map((n) => (
            <div className="item" key={n.id}>
              <div className="item-label">
                <span className="badge">
                  {n.id} · {n.explicacionId}
                </span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={problemasNuevosExcluidos.has(n.id)}
                    onChange={() => toggleSet(problemasNuevosExcluidos, n.id, setProblemasNuevosExcluidos)}
                  />
                  Excluir
                </label>
              </div>
              <textarea
                value={n.enunciado}
                onChange={(ev) =>
                  setProblemasNuevos((prev) =>
                    prev.map((x) => (x.id === n.id ? { ...x, enunciado: ev.target.value } : x))
                  )
                }
              />
              <div className="item-label" style={{ marginTop: "0.4rem" }}>
                <span>
                  ¿El autor la reconoce? <span className="badge">{n.reconocidoPorAutor === "Si" ? "Sí" : "No"}</span>
                </span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{n.justificacion}</div>
            </div>
          ))}

          {alcances.length > 0 && (
            <div className="discarded-list">
              <h3>Alcance de las explicaciones fuertes</h3>
              {alcances.map((a) => (
                <div className="item" key={a.explicacionId}>
                  <div className="item-label">
                    <span className="badge">{a.explicacionId}</span>
                  </div>
                  <select
                    value={a.tipo}
                    onChange={(ev) =>
                      setAlcances((prev) =>
                        prev.map((x) =>
                          x.explicacionId === a.explicacionId
                            ? { ...x, tipo: ev.target.value as Alcance["tipo"] }
                            : x
                        )
                      )
                    }
                  >
                    <option value="Amplio">Amplio</option>
                    <option value="Limitado">Limitado</option>
                  </select>
                  <textarea
                    value={a.justificacion}
                    onChange={(ev) =>
                      setAlcances((prev) =>
                        prev.map((x) =>
                          x.explicacionId === a.explicacionId ? { ...x, justificacion: ev.target.value } : x
                        )
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep6}>
              {loading ? "Comparando explicaciones..." : "Continuar"}
            </button>
          </div>
        </div>
      )}

      {step === 7 && (
        <div className="card">
          <h2>Relaciones entre explicaciones</h2>
          {relaciones.length === 0 && (
            <p className="loading">No se encontraron explicaciones comparables entre sí.</p>
          )}
          {relaciones.map((r, i) => (
            <div className="item" key={i}>
              <div className="item-label">
                <span className="badge">
                  {r.explicacionAId} / {r.explicacionBId}
                </span>
              </div>
              <select
                value={r.tipo}
                onChange={(ev) =>
                  setRelaciones((prev) =>
                    prev.map((x, idx) =>
                      idx === i ? { ...x, tipo: ev.target.value as Relacion["tipo"] } : x
                    )
                  )
                }
              >
                <option value="compite_con">compite_con</option>
                <option value="complementa">complementa</option>
              </select>
              <textarea
                value={r.justificacion}
                onChange={(ev) =>
                  setRelaciones((prev) =>
                    prev.map((x, idx) => (idx === i ? { ...x, justificacion: ev.target.value } : x))
                  )
                }
              />
            </div>
          ))}
          <div className="actions">
            <button className="primary" disabled={loading} onClick={runStep7}>
              {loading ? "Redactando reporte..." : "Generar reporte final"}
            </button>
          </div>
        </div>
      )}

      {step === 8 && (
        <div className="card">
          <h2>Reporte final</h2>
          <div className="report-preview">{reporte}</div>
          <div className="actions">
            <button onClick={() => window.location.reload()}>Analizar otro texto</button>
            <button
              onClick={() => download(`tripletas-${buildFilenameBase()}.txt`, buildMetaHeader() + buildTripletas())}
            >
              Descargar tripletas.txt
            </button>
            <button
              className="primary"
              onClick={() => download(`reporte-${buildFilenameBase()}.md`, buildMetaHeader() + reporte)}
            >
              Descargar reporte.md
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
