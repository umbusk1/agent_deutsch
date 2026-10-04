"use client";

import { useState } from "react";

type ResultadoCorrida = {
  controlId: string;
  corrida: number;
  veredicto: string | null;
  detalle: unknown;
  ms: number;
  error?: string;
};

const STORAGE_KEY = "experimento-detector-log";

function cargarDeSessionStorage(): ResultadoCorrida[] {
  if (typeof window === "undefined") return [];
  try {
    const guardado = sessionStorage.getItem(STORAGE_KEY);
    return guardado ? (JSON.parse(guardado) as ResultadoCorrida[]) : [];
  } catch {
    return [];
  }
}

function guardarEnSessionStorage(resultados: ResultadoCorrida[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(resultados));
  } catch {
    // sessionStorage puede fallar (modo privado, cuota) — no es crítico, los resultados siguen en pantalla.
  }
}

// Página temporal de diagnóstico — sin link en ninguna navegación, sin persistencia en Redis. Ver
// diagnostico/umbrales-detector.txt para el criterio congelado completo. La etiqueta esperada de cada control
// NUNCA se manda al servidor — vive solo acá, para referencia visual mientras se mira la tabla.
export default function ExperimentoDetectorPage() {
  const [controlId, setControlId] = useState("");
  const [texto, setTexto] = useState("");
  const [enunciado, setEnunciado] = useState("");
  const [nCorridas, setNCorridas] = useState(5);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoCorrida[]>(cargarDeSessionStorage);

  async function ejecutar() {
    setCorriendo(true);
    setError(null);
    // Arranca desde lo ya acumulado — cada ejecución AGREGA filas, nunca reemplaza el log (para poder correr
    // los 10 controles uno por uno desde la misma pestaña sin perder los anteriores).
    const acumulado: ResultadoCorrida[] = [...resultados];
    try {
      const res = await fetch("/api/admin/experimento-detector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: controlId.trim(),
          texto,
          enunciado: enunciado.trim(),
          corridas: nCorridas,
        }),
      });
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

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue; // heartbeat
          const payload = JSON.parse(dataLine.slice(5).trim());
          if (payload.error && payload.corrida === undefined) {
            throw new Error(payload.error);
          }
          acumulado.push(payload);
          setResultados([...acumulado]);
          guardarEnSessionStorage(acumulado);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setCorriendo(false);
    }
  }

  function descargar() {
    const blob = new Blob([JSON.stringify(resultados, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `experimento-detector-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace", maxWidth: "70rem" }}>
      <h1>Experimento del detector de problemas perversos (temporal, admin)</h1>
      <p>Ver diagnostico/umbrales-detector.txt para el criterio congelado. Nada de esto se persiste.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
        <label>
          controlId:{" "}
          <input value={controlId} onChange={(e) => setControlId(e.target.value)} style={{ width: "16rem" }} />
        </label>
        <label>
          enunciado:{" "}
          <input
            value={enunciado}
            onChange={(e) => setEnunciado(e.target.value)}
            style={{ width: "100%", maxWidth: "60rem" }}
          />
        </label>
        <label>
          texto:
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={10}
            style={{ width: "100%", maxWidth: "60rem", fontFamily: "monospace" }}
          />
        </label>
        <label>
          N corridas:{" "}
          <input
            type="number"
            min={1}
            value={nCorridas}
            onChange={(e) => setNCorridas(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: "4rem" }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button onClick={ejecutar} disabled={corriendo || !controlId.trim() || !texto.trim() || !enunciado.trim()}>
          {corriendo ? "Corriendo..." : `Ejecutar ${nCorridas} corrida${nCorridas === 1 ? "" : "s"}`}
        </button>
        <button onClick={descargar} disabled={resultados.length === 0}>
          Descargar resultados (JSON)
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Control", "Corrida", "Veredicto", "ms", "Error"].map((h) => (
              <th key={h} style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem", textAlign: "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resultados.map((r, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.controlId}</td>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.corrida}</td>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.veredicto ?? "—"}</td>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.ms}</td>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem", color: "crimson" }}>
                {r.error ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
