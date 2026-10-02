"use client";

import { useState } from "react";

type ResultadoCorrida = {
  metodo: string;
  corrida: number;
  etiqueta: string | null;
  detalle: unknown;
  ms: number;
  error?: string;
};

const STORAGE_KEY = "experimento-umbrales-log";

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
// diagnostico/umbrales-experimento.txt para el diseño del experimento completo.
export default function ExperimentoUmbralesPage() {
  const [analisisId, setAnalisisId] = useState("");
  const [explicacionId, setExplicacionId] = useState("E1");
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoCorrida[]>(cargarDeSessionStorage);

  async function ejecutarPiloto() {
    setCorriendo(true);
    setError(null);
    const acumulado: ResultadoCorrida[] = [];
    setResultados(acumulado);
    try {
      const res = await fetch("/api/admin/experimento-umbrales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analisisId: analisisId.trim(),
          explicacionId: explicacionId.trim(),
          metodos: ["A", "A+", "B", "C"],
          corridas: 1,
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
          if (payload.error && payload.metodo === undefined) {
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
    const paraDescargar = resultados.map((r) => ({
      metodo: r.metodo,
      corrida: r.corrida,
      etiqueta: r.etiqueta,
      ms: r.ms,
      error: r.error ?? null,
      detalle: r.detalle,
    }));
    const blob = new Blob([JSON.stringify(paraDescargar, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `experimento-umbrales-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace", maxWidth: "70rem" }}>
      <h1>Experimento de umbrales (temporal, admin)</h1>
      <p>Ver diagnostico/umbrales-experimento.txt para el diseño completo. Nada de esto se persiste.</p>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <label>
          analisisId:{" "}
          <input
            value={analisisId}
            onChange={(e) => setAnalisisId(e.target.value)}
            style={{ width: "24rem" }}
          />
        </label>
        <label>
          explicacionId: <input value={explicacionId} onChange={(e) => setExplicacionId(e.target.value)} />
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button onClick={ejecutarPiloto} disabled={corriendo || !analisisId.trim()}>
          {corriendo ? "Corriendo..." : "Ejecutar piloto (1 corrida × 4 métodos)"}
        </button>
        <button onClick={descargar} disabled={resultados.length === 0}>
          Descargar resultados (JSON)
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Método", "Corrida", "Etiqueta", "ms", "Error"].map((h) => (
              <th key={h} style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem", textAlign: "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resultados.map((r, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.metodo}</td>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.corrida}</td>
              <td style={{ border: "1px solid #ccc", padding: "0.25rem 0.5rem" }}>{r.etiqueta ?? "—"}</td>
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
