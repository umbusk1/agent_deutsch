"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader } from "@/components/Loader";
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

const STEP_LABELS = ["Texto", "Problema", "Explicación", "Test", "Consecuencia", "Reporte"];

const MENSAJES_PROBLEMA = [
  "Buscando el conflicto que organiza el texto...",
  "Distinguiendo un tema de un problema real...",
  "Revisando si el autor deja preguntas sin resolver...",
];

const MENSAJES_EXPLICACION = [
  "Buscando explicaciones genuinas para cada problema...",
  "Separando narración de explicación...",
  "Chequeando si cada explicación conecta con el problema central...",
];

const MENSAJES_TEST_VARIANTES = [
  "Buscando pasajes que piden lealtad en vez de razones...",
  "Generando variantes de cada explicación...",
  "Cambiando motivos y mecanismos, uno a la vez...",
  "Separando ingenio de descalificación...",
];

const MENSAJES_TEST_VEREDICTOS = [
  "Poniendo a prueba cada variante...",
  "Viendo si el problema sobrevive el cambio de detalles...",
  "Redactando los veredictos...",
];

const MENSAJES_CONSECUENCIA = [
  "Buscando qué preguntas nuevas abre cada explicación fuerte...",
  "Evaluando si el alcance de la explicación es amplio o limitado...",
  "Comparando explicaciones entre sí...",
  "Buscando relaciones de competencia o complemento...",
];

const MENSAJES_REPORTE = [
  "Redactando la sección de explicaciones...",
  "Redactando la sección de persuasión...",
  "Ensamblando introducción y cierre...",
  "Guardando en la biblioteca...",
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

  // Compuerta de rechazo temprano: si el Paso 1 no encuentra ningún problema genuino, el pipeline
  // se detiene aquí (no hay reporte ni datos que guardar) y se ofrece un camino de apelación.
  const [rejected, setRejected] = useState(false);
  const [apelacionTexto, setApelacionTexto] = useState("");
  const [apelacionEnviando, setApelacionEnviando] = useState(false);
  const [apelacionEnviada, setApelacionEnviada] = useState(false);
  const [apelacionError, setApelacionError] = useState<string | null>(null);

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
  // Dentro de "Test", separa la fase de revisar variantes (antes de pedir veredictos, el único corte
  // que protege gasto real) de la fase donde los veredictos ya están listos para revisar.
  const [veredictosCalculados, setVeredictosCalculados] = useState(false);

  const [problemasNuevos, setProblemasNuevos] = useState<ProblemaNuevo[]>([]);
  const [problemasNuevosExcluidos, setProblemasNuevosExcluidos] = useState<Set<string>>(new Set());
  const [alcances, setAlcances] = useState<Alcance[]>([]);

  const [relaciones, setRelaciones] = useState<Relacion[]>([]);
  const [reporte, setReporte] = useState("");
  const [guardadoEstado, setGuardadoEstado] = useState<"guardando" | "ok" | "error" | null>(null);

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

  // Los Pasos 1 y 7 responden con Server-Sent Events (heartbeats + un evento final) en vez de JSON
  // directo, para mantener la conexión viva durante las llamadas largas a Claude.
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
      const data = await callApiStream<{ problemas: Problema[] }>("/api/step1", { texto });
      // La llamada ya se hizo y ya consumió cupo real, haya o no problema — se refleja siempre.
      setQuota((prev) =>
        prev && !prev.unlimited && typeof prev.remaining === "number"
          ? { ...prev, remaining: Math.max(0, prev.remaining - 1) }
          : prev
      );

      if (data.problemas.length === 0) {
        setRejected(true);
        return;
      }

      setProblemas(data.problemas);
      setProblemasExcluidos(new Set());
      // Invalida todo lo que dependía de una corrida anterior.
      setExplicaciones([]);
      setDescartadas([]);
      setExcluidas(new Set());
      setPasajesPersuasivos([]);
      setPasajesExcluidos(new Set());
      setVariantesAceptadas([]);
      setVariantesDescartadas([]);
      setVeredictos([]);
      setVeredictosCalculados(false);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
      setStep(1);
      setFurthestStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function enviarApelacion() {
    if (!apelacionTexto.trim()) return;
    setApelacionEnviando(true);
    setApelacionError(null);
    try {
      await callApi("/api/apelar", { texto, justificacion: apelacionTexto });
      setApelacionEnviada(true);
    } catch (e) {
      setApelacionError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setApelacionEnviando(false);
    }
  }

  async function runStep2() {
    const problemasActivos = problemas.filter((p) => !problemasExcluidos.has(p.id));
    setLoading(true);
    setError(null);
    try {
      const data = await callApi<{ explicaciones: Explicacion[]; descartadas: Descartada[] }>(
        "/api/step2",
        { texto, problemas: problemasActivos }
      );
      setProblemas(problemasActivos);
      setExplicaciones(data.explicaciones);
      setDescartadas(data.descartadas);
      setExcluidas(new Set());
      setPasajesPersuasivos([]);
      setPasajesExcluidos(new Set());
      setVariantesAceptadas([]);
      setVariantesDescartadas([]);
      setVeredictos([]);
      setVeredictosCalculados(false);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
      setStep(2);
      setFurthestStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  // Entrada a "Test": Persuasión (independiente del texto, no depende de qué explicaciones queden
  // activas) y Variantes (sí depende de las explicaciones activas) no dependen una de la otra —
  // corren en paralelo. El motor sigue haciendo las mismas dos llamadas de siempre; lo que cambia es
  // que el usuario ve una sola pantalla ("Test") en vez de dos.
  async function runTest() {
    const explicacionesActivas = explicaciones.filter((e) => !excluidas.has(e.id));
    setLoading(true);
    setError(null);
    try {
      const [pasajesData, variantesData] = await Promise.all([
        callApi<{ pasajesPersuasivos: PasajePersuasivo[] }>("/api/step1b", { texto }),
        callApi<{ variantesAceptadas: VarianteAceptada[]; variantesDescartadas: VarianteDescartada[] }>(
          "/api/step3",
          { texto, explicaciones: explicacionesActivas, problemas }
        ),
      ]);
      setExplicaciones(explicacionesActivas);
      setPasajesPersuasivos(pasajesData.pasajesPersuasivos);
      setPasajesExcluidos(new Set());
      setVariantesAceptadas(variantesData.variantesAceptadas);
      setVariantesDescartadas(variantesData.variantesDescartadas);
      setVariantesExcluidas(new Set());
      setVeredictos([]);
      setVeredictosCalculados(false);
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

  // Segunda fase, dentro de "Test": el único corte manual que se conserva — las variantes excluidas
  // aquí nunca llegan a pedir veredicto (a diferencia de las demás exclusiones de la app, que solo se
  // aplican, de forma cosmética, al armar el reporte final).
  async function runVeredictos() {
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
      setVeredictosCalculados(true);
      setProblemasNuevos([]);
      setAlcances([]);
      setRelaciones([]);
      setReporte("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  // Entrada a "Consecuencia": Preguntas nuevas/Alcance y Relaciones no se necesitan entre sí (Relaciones
  // solo usa explicaciones y problemas), así que corren en paralelo, igual que Persuasión+Variantes.
  async function runConsecuencia() {
    setLoading(true);
    setError(null);
    try {
      const [nuevosData, relacionesData] = await Promise.all([
        callApi<{ problemasNuevos: ProblemaNuevo[]; alcances: Alcance[] }>("/api/step5", {
          texto,
          explicaciones,
          problemas,
          veredictos,
        }),
        callApi<{ relaciones: Relacion[] }>("/api/step6", { explicaciones, problemas }),
      ]);
      setProblemasNuevos(nuevosData.problemasNuevos);
      setProblemasNuevosExcluidos(new Set());
      setAlcances(nuevosData.alcances);
      setRelaciones(relacionesData.relaciones);
      setReporte("");
      setStep(4);
      setFurthestStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function runStep7() {
    const pasajesActivos = pasajesPersuasivos.filter((p) => !pasajesExcluidos.has(p.id));
    const problemasNuevosActivos = problemasNuevos.filter((p) => !problemasNuevosExcluidos.has(p.id));
    setLoading(true);
    setError(null);
    try {
      const data = await callApiStream<{ reporte: string }>("/api/step7", {
        texto,
        explicaciones,
        problemas,
        veredictos,
        problemasNuevos: problemasNuevosActivos,
        relaciones,
        pasajesPersuasivos: pasajesActivos,
        alcances,
      });
      setPasajesPersuasivos(pasajesActivos);
      setProblemasNuevos(problemasNuevosActivos);
      setReporte(data.reporte);
      setStep(5);
      setFurthestStep(5);

      // Guardado en la biblioteca compartida: no bloquea ni revierte la vista del reporte si falla —
      // el usuario ya tiene su reporte y puede descargarlo igual; el estado se refleja de forma discreta.
      setGuardadoEstado("guardando");
      try {
        await callApi("/api/analisis", {
          metaFecha,
          metaAutor,
          metaMedio,
          metaTitulo,
          reporte: data.reporte,
          tripletas: buildTripletas(),
          problemas,
          explicaciones,
        });
        setGuardadoEstado("ok");
      } catch {
        setGuardadoEstado("error");
      }
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
    for (const p of problemas) lines.push(`${p.id} (${p.tipo}): ${p.enunciado}`);
    for (const e of explicaciones) lines.push(`${e.id}: ${e.resumen}`);
    for (const e of explicaciones) lines.push(`${e.id} (mecanismo general): ${e.mecanismoGeneral}`);
    for (const e of explicaciones) {
      if (e.puente.laguna) lines.push(`${e.id} (laguna de puente): ${e.puente.justificacion}`);
    }
    for (const v of variantesAceptadas) lines.push(`${v.id} (${v.tipo}): ${v.descripcion}`);
    for (const n of problemasNuevos) lines.push(`${n.id}: ${n.enunciado}`);
    for (const a of alcances) lines.push(`${a.explicacionId} (alcance): ${a.justificacion}`);
    for (const m of pasajesPersuasivos) lines.push(`${m.id}: ${m.cita}`);

    lines.push("", "# Tripletas", "");
    for (const m of pasajesPersuasivos) {
      lines.push(`${m.id} --usa_mecanismo--> ${m.mecanismo}`);
      for (const t of m.tecnicas) lines.push(`${m.id} --tecnica--> ${t}`);
    }
    for (const e of explicaciones) {
      const p = problemas.find((p) => p.id === e.problemaId);
      if (p) lines.push(`${e.id} --resuelve--> ${p.id}`);
      if (e.puente.laguna) lines.push(`${e.id} --tiene_laguna_de_puente--> true`);
    }
    for (const v of variantesAceptadas) {
      lines.push(`${v.id} --es_variante_de--> ${v.explicacionId}`);
      const veredicto = veredictos.find((ve) => ve.explicacionId === v.explicacionId);
      const resultado = veredicto?.resultadosVariantes.find((r) => r.varianteId === v.id);
      const explicacionDeVariante = explicaciones.find((e) => e.id === v.explicacionId);
      const problema = explicacionDeVariante
        ? problemas.find((p) => p.id === explicacionDeVariante.problemaId)
        : undefined;
      if (resultado && problema) {
        lines.push(`${v.id} --${resultado.resultado}--> ${problema.id}`);
      }
    }
    for (const ve of veredictos) {
      lines.push(`${ve.explicacionId} --tiene_veredicto--> ${ve.veredicto}`);
      if (ve.resisteConocimientoNuevo) {
        lines.push(`${ve.explicacionId} --resiste_conocimiento_nuevo--> ${ve.resisteConocimientoNuevo.resultado}`);
      }
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

  if (rejected) {
    return (
      <div className="container">
        <div className="header">
          <Link href="/">← Biblioteca</Link>
          <h1>Agente Deutsch</h1>
        </div>
        <div className="card">
          <h2>Este texto no parece tener material para analizar</h2>
          <p>
            Este texto no parece plantear ningún conflicto o pregunta abierta que el Agente Deutsch
            pueda examinar — no encontramos una tensión entre lo que se espera y lo que se observa, ni
            dos ideas que no puedan ser ambas ciertas. Sin un problema así, no hay ninguna explicación
            que poner a prueba.
          </p>
          {!apelacionEnviada ? (
            <>
              <div className="item-label" style={{ marginTop: "1rem" }}>
                <span>¿Por qué crees que sí hay material analizable aquí?</span>
              </div>
              <textarea
                value={apelacionTexto}
                onChange={(e) => setApelacionTexto(e.target.value)}
                placeholder="Explica qué conflicto o pregunta crees que el texto sí plantea..."
              />
              {apelacionError && <div className="error-banner">{apelacionError}</div>}
              <div className="actions">
                <button onClick={() => window.location.reload()}>Analizar otro texto</button>
                <button
                  className="primary"
                  disabled={apelacionEnviando || !apelacionTexto.trim()}
                  onClick={enviarApelacion}
                >
                  {apelacionEnviando ? "Enviando..." : "Apelar este rechazo"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: "1rem" }}>
                Tu apelación fue enviada. Si se acepta, se te avisará por correo y se te restaurará el
                uso consumido.
              </p>
              <div className="actions">
                <button className="primary" onClick={() => window.location.reload()}>
                  Analizar otro texto
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <Link href="/">← Biblioteca</Link>
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
                <span>Título corto</span>
              </div>
              <input
                type="text"
                value={metaTitulo}
                onChange={(e) => setMetaTitulo(e.target.value)}
                placeholder="ej. crisis-migratoria"
              />
            </div>
          </div>
          {/* Obligatorio: la Biblioteca es compartida entre los 3 usuarios, y un "(sin título)" ahí genera
              confusión real para los otros dos, no solo para quien corrió el análisis. */}
          {!metaTitulo.trim() && (
            <p className="loading" style={{ marginTop: "0.5rem" }}>
              El título es obligatorio — la Biblioteca lo usa para identificar el análisis frente a los demás usuarios.
            </p>
          )}
          {quota && !quota.unlimited && (
            <p className="loading" style={{ marginTop: "0.75rem" }}>
              {quota.remaining === 0
                ? `Ya usaste tus ${quota.limit} análisis de esta semana. El cupo se reinicia el próximo lunes.`
                : `Te quedan ${quota.remaining} de ${quota.limit} análisis esta semana.`}
            </p>
          )}
          {loading ? (
            <Loader messages={MENSAJES_PROBLEMA} />
          ) : (
            <div className="actions">
              <button
                className="primary"
                disabled={loading || !texto.trim() || !metaTitulo.trim() || quota?.remaining === 0}
                onClick={() => setShowConfirm(true)}
              >
                Comenzar análisis
              </button>
            </div>
          )}

          {showConfirm && !loading && (
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
                  Confirmar y analizar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>Problema que plantea el texto</h2>
          <p className="loading" style={{ marginBottom: "1rem" }}>
            Detectado antes de buscar ninguna explicación. Poda o edita los que no te interesen — el
            siguiente paso solo busca explicaciones para los problemas que queden activos.
          </p>
          {problemas.map((p) => (
            <div className="item" key={p.id} style={{ opacity: problemasExcluidos.has(p.id) ? 0.5 : 1 }}>
              <div className="item-label">
                <span className="badge">
                  {p.id} · {p.tipo === "maestro" ? "Maestro" : "Local"}
                </span>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={problemasExcluidos.has(p.id)}
                    onChange={() => toggleSet(problemasExcluidos, p.id, setProblemasExcluidos)}
                  />
                  Excluir
                </label>
              </div>
              <textarea
                value={p.enunciado}
                disabled={problemasExcluidos.has(p.id)}
                onChange={(ev) =>
                  setProblemas((prev) =>
                    prev.map((x) => (x.id === p.id ? { ...x, enunciado: ev.target.value } : x))
                  )
                }
              />
            </div>
          ))}
          {loading ? (
            <Loader messages={MENSAJES_EXPLICACION} />
          ) : (
            <div className="actions">
              <button className="primary" disabled={loading} onClick={runStep2}>
                Continuar
              </button>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>Explicaciones candidatas</h2>
          {explicaciones.map((e) => {
            const problema = problemas.find((p) => p.id === e.problemaId);
            return (
              <div className="item" key={e.id}>
                <div className="item-label">
                  <span className="badge">
                    {e.id} · resuelve {e.problemaId}
                  </span>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={excluidas.has(e.id)}
                      onChange={() => toggleSet(excluidas, e.id, setExcluidas)}
                    />
                    Excluir del análisis
                  </label>
                </div>
                {problema && <div className="quote">&ldquo;{problema.enunciado}&rdquo;</div>}
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
                {e.puente.laguna && (
                  <p className="warning-note" style={{ marginTop: "0.5rem" }}>
                    Puente sin argumentar: {e.puente.justificacion}
                  </p>
                )}
              </div>
            );
          })}

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

          {loading ? (
            <Loader messages={MENSAJES_TEST_VARIANTES} />
          ) : (
            <div className="actions">
              <button className="primary" disabled={loading} onClick={runTest}>
                Continuar
              </button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h2>Test: persuasión, variantes y veredictos</h2>

          <h3>Pasajes con mecanismo de persuasión</h3>
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

          <h3 style={{ marginTop: "1.5rem" }}>Variantes por explicación</h3>
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
                          disabled={veredictosCalculados}
                          onChange={() => toggleSet(variantesExcluidas, v.id, setVariantesExcluidas)}
                        />
                        Excluir
                      </label>
                    </div>
                    <textarea
                      value={v.descripcion}
                      disabled={veredictosCalculados}
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

          {!veredictosCalculados && (
            <p className="warning-note" style={{ marginTop: "1rem" }}>
              Excluye aquí las variantes que no quieras evaluar — a diferencia de las demás exclusiones
              de esta app, estas sí cambian qué se le pide al modelo. Excluir algunas abarata la
              evaluación de esa explicación (menos variantes que revisar en la misma llamada); para
              saltarte por completo el costo de una explicación, excluye todas sus variantes. Una vez
              que continúes, esta lista queda fija.
            </p>
          )}

          {!veredictosCalculados ? (
            loading ? (
              <Loader messages={MENSAJES_TEST_VEREDICTOS} />
            ) : (
              <div className="actions">
                <button className="primary" disabled={loading} onClick={runVeredictos}>
                  Pedir veredictos de las variantes activas
                </button>
              </div>
            )
          ) : (
            <>
              <h3 style={{ marginTop: "1.5rem" }}>Veredictos</h3>
              {veredictos.map((ve) => {
                const e = explicaciones.find((x) => x.id === ve.explicacionId);
                return (
                  <div className="item" key={ve.explicacionId}>
                    <h3>
                      {e?.id}: {e?.resumen}
                    </h3>
                    {ve.veredicto === "SinSustitutoGenuino" && (
                      <p className="warning-note">
                        El paso anterior no logró generar ninguna variante que compitiera genuinamente por
                        el mismo problema — esta explicación no fue puesta a prueba. No es lo mismo que
                        &ldquo;difícil de variar&rdquo;.
                      </p>
                    )}
                    {ve.resultadosVariantes.map((r) => {
                      const v = variantesAceptadas.find((x) => x.id === r.varianteId);
                      return (
                        <div key={r.varianteId} style={{ marginBottom: "0.4rem", fontSize: "0.85rem" }}>
                          <span className="badge">{r.resultado}</span>{" "}
                          {v?.tipo === "conocimiento_nuevo" && <span className="badge">conocimiento nuevo</span>}{" "}
                          {v?.descripcion}
                          <div style={{ color: "var(--muted)" }}>{r.justificacion}</div>
                        </div>
                      );
                    })}
                    {ve.resisteConocimientoNuevo && (
                      <p className="warning-note" style={{ marginTop: "0.5rem" }}>
                        Conocimiento nuevo (aparte del veredicto principal):{" "}
                        <span className="badge">{ve.resisteConocimientoNuevo.resultado}</span>{" "}
                        {ve.resisteConocimientoNuevo.justificacion}
                      </p>
                    )}
                    <div className="item-label" style={{ marginTop: "0.6rem" }}>
                      <span>Veredicto principal</span>
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

              {loading ? (
                <Loader messages={MENSAJES_CONSECUENCIA} />
              ) : (
                <div className="actions">
                  <button className="primary" disabled={loading} onClick={runConsecuencia}>
                    Continuar
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h2>Consecuencia: preguntas nuevas y relaciones</h2>

          <h3>Preguntas nuevas que abren las explicaciones fuertes</h3>
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

          <h3 style={{ marginTop: "1.5rem" }}>Relaciones entre explicaciones</h3>
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

          {loading ? (
            <Loader messages={MENSAJES_REPORTE} />
          ) : (
            <div className="actions">
              <button className="primary" disabled={loading} onClick={runStep7}>
                Generar reporte final
              </button>
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="card">
          <h2>Reporte final</h2>
          {guardadoEstado === "guardando" && <p className="loading">Guardando en la biblioteca...</p>}
          {guardadoEstado === "error" && (
            <div className="error-banner">
              No se pudo guardar este análisis en la biblioteca compartida (puedes descargarlo igual abajo).
            </div>
          )}
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
