"use client";

import { useRef, useState } from "react";

type CitaVerificada = {
  texto: string;
  vacia: boolean;
  valida: boolean | null;
  partes: number;
};

type Fila = {
  controlId: string;
  corrida: number;
  tipoCambio: string | null;
  citaV1: CitaVerificada | null;
  citaV2: CitaVerificada | null;
  comentario: string | null;
  ms: number;
  error: string | null;
};

type Textos = { v1?: string; v2?: string };

const CONTROLES = ["P1", "P2", "P3", "A1", "A2", "A3", "A4", "A5", "A6", "A7"];
const CONCURRENCIA = 2;
const STORAGE_KEY = "experimento-versiones-log";

function cargarDeSessionStorage(): Fila[] {
  if (typeof window === "undefined") return [];
  try {
    const guardado = sessionStorage.getItem(STORAGE_KEY);
    return guardado ? (JSON.parse(guardado) as Fila[]) : [];
  } catch {
    return [];
  }
}

function guardarEnSessionStorage(filas: Fila[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filas));
  } catch {
    // sessionStorage puede fallar (modo privado, cuota) — no es crítico, las filas siguen en pantalla.
  }
}

function marcaCita(c: CitaVerificada | null): string {
  if (!c) return "—";
  if (c.vacia) return "vacía";
  return c.valida ? "✓ válida" : "✗ inválida";
}

// Página temporal de diagnóstico (Prueba 2: comparación entre versiones) — sin link en ninguna navegación,
// sin persistencia en Redis. Los textos se leen en el navegador y solo viajan, de a un par por llamada, a la
// ruta de admin. El tipo de cambio verdadero de cada control NUNCA se manda al servidor ni se muestra acá.
export default function ExperimentoVersionesPage() {
  const [textos, setTextos] = useState<Record<string, Textos>>({});
  const [archivosIgnorados, setArchivosIgnorados] = useState<string[]>([]);
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>(
    Object.fromEntries(CONTROLES.map((c) => [c, true]))
  );
  const [nCorridas, setNCorridas] = useState(5);
  const [corriendo, setCorriendo] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>(cargarDeSessionStorage);

  const filasRef = useRef<Fila[]>([]);
  const detenerRef = useRef(false);

  async function leerArchivos(lista: FileList | null) {
    if (!lista) return;
    const nuevos: Record<string, Textos> = {};
    const ignorados: string[] = [];
    for (const archivo of Array.from(lista)) {
      const m = /^(P[1-3]|A[1-7])-v([12])\.txt$/i.exec(archivo.name);
      if (!m) {
        ignorados.push(archivo.name);
        continue;
      }
      const id = m[1].toUpperCase();
      const version = m[2] === "1" ? "v1" : "v2";
      nuevos[id] = { ...nuevos[id], [version]: await archivo.text() };
    }
    setTextos(nuevos);
    setArchivosIgnorados(ignorados);
  }

  const completos = CONTROLES.filter((c) => textos[c]?.v1 && textos[c]?.v2);
  const elegidos = CONTROLES.filter((c) => seleccion[c]);
  const faltantes = elegidos.filter((c) => !completos.includes(c));
  const puedeCorrer = !corriendo && elegidos.length > 0 && faltantes.length === 0;

  function agregarFila(fila: Fila) {
    filasRef.current = [...filasRef.current, fila];
    setFilas(filasRef.current);
    guardarEnSessionStorage(filasRef.current);
  }

  // Una corrida = un request a la ruta = una sola llamada al modelo. Sin reintentos automáticos.
  async function ejecutarTarea(controlId: string, corrida: number) {
    const inicio = Date.now();
    try {
      const res = await fetch("/api/admin/experimento-versiones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId,
          corrida,
          textoV1: textos[controlId].v1,
          textoV2: textos[controlId].v2,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Error HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("El servidor no devolvió una respuesta.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: (Fila & { error: string | null }) | { error: string; corrida?: undefined } | null = null;
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
          payload = JSON.parse(dataLine.slice(5).trim());
        }
      }
      if (!payload) throw new Error("El servidor no devolvió ninguna fila.");
      if (payload.error && payload.corrida === undefined) {
        // Error de acceso o de validación: no tiene sentido seguir con el resto.
        detenerRef.current = true;
        setError(payload.error);
        return;
      }
      agregarFila(payload as Fila);
    } catch (e) {
      agregarFila({
        controlId,
        corrida,
        tipoCambio: null,
        citaV1: null,
        citaV2: null,
        comentario: null,
        ms: Date.now() - inicio,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function correr() {
    setCorriendo(true);
    setError(null);
    detenerRef.current = false;
    // Cada ejecución EMPIEZA un log nuevo, para que las filas del piloto nunca se mezclen con la corrida
    // completa (el piloto no cuenta). Al terminar se descarga el JSON de esa ejecución.
    filasRef.current = [];
    setFilas([]);

    // Orden congelado: primero la corrida 1 de todos los controles marcados, luego la 2, y así.
    const tareas: { controlId: string; corrida: number }[] = [];
    for (let corrida = 1; corrida <= nCorridas; corrida++) {
      for (const controlId of elegidos) tareas.push({ controlId, corrida });
    }
    setTotal(tareas.length);

    let siguiente = 0;
    const trabajador = async () => {
      while (!detenerRef.current) {
        const i = siguiente++;
        if (i >= tareas.length) return;
        await ejecutarTarea(tareas[i].controlId, tareas[i].corrida);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCIA }, () => trabajador()));

    setCorriendo(false);
    if (filasRef.current.length > 0) descargar(filasRef.current, tareas.length);
  }

  function descargar(filasADescargar: Fila[], tareasPedidas: number) {
    const caracteres: Record<string, { v1: number; v2: number }> = {};
    for (const c of CONTROLES) {
      if (textos[c]?.v1 && textos[c]?.v2) caracteres[c] = { v1: textos[c].v1!.length, v2: textos[c].v2!.length };
    }
    const salida = {
      meta: {
        fecha: new Date().toISOString(),
        experimento: "versiones (Prueba 2, criterio congelado 2026-10-08)",
        controlesPedidos: elegidos,
        corridasPorControl: nCorridas,
        corridasPedidas: tareasPedidas,
        filasRecibidas: filasADescargar.length,
        concurrencia: CONCURRENCIA,
        reintentos: "ninguno",
        modelo: "el que usa callTool en src/lib/anthropic.ts (esta página no lo registra)",
        caracteres,
      },
      filas: filasADescargar,
    };
    const blob = new Blob([JSON.stringify(salida, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `experimento-versiones-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const celda = { border: "1px solid #ccc", padding: "0.25rem 0.5rem" } as const;

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace", maxWidth: "70rem" }}>
      <h1>Prueba 2: comparación entre versiones (temporal, admin)</h1>
      <p>Criterio congelado el 2026-10-08. Nada de esto se persiste en el servidor.</p>
      <p style={{ color: "crimson", fontWeight: "bold" }}>
        No cierres esta pestaña hasta que se descargue el JSON.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
        <label>
          Archivos (elige los 20 a la vez: P1-v1.txt, P1-v2.txt, … A7-v2.txt):{" "}
          <input type="file" accept=".txt" multiple onChange={(e) => leerArchivos(e.target.files)} />
        </label>

        {archivosIgnorados.length > 0 && (
          <p style={{ color: "crimson" }}>Archivos ignorados (nombre no reconocido): {archivosIgnorados.join(", ")}</p>
        )}

        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Correr", "Control", "Caracteres v1", "Caracteres v2", "Estado"].map((h) => (
                <th key={h} style={{ ...celda, textAlign: "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CONTROLES.map((c) => {
              const t = textos[c];
              const ok = Boolean(t?.v1 && t?.v2);
              return (
                <tr key={c}>
                  <td style={celda}>
                    <input
                      type="checkbox"
                      checked={Boolean(seleccion[c])}
                      onChange={(e) => setSeleccion({ ...seleccion, [c]: e.target.checked })}
                      disabled={corriendo}
                    />
                  </td>
                  <td style={celda}>{c}</td>
                  <td style={celda}>{t?.v1 ? t.v1.length : "—"}</td>
                  <td style={celda}>{t?.v2 ? t.v2.length : "—"}</td>
                  <td style={{ ...celda, color: ok ? "inherit" : "crimson" }}>
                    {ok ? "listo" : t ? "falta una de las dos versiones" : "sin archivos"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <label>
          Corridas por control (1 a 5):{" "}
          <input
            type="number"
            min={1}
            max={5}
            value={nCorridas}
            onChange={(e) => setNCorridas(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: "4rem" }}
          />
        </label>
        <p style={{ margin: 0 }}>
          Piloto: marca solo A4 y pon 2 corridas. Corrida completa: marca los 10 y pon 5 corridas (50 en total).
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button onClick={correr} disabled={!puedeCorrer}>
          {corriendo ? "Corriendo..." : `Correr ${elegidos.length * nCorridas} corridas`}
        </button>
        <button
          onClick={() => {
            detenerRef.current = true;
          }}
          disabled={!corriendo}
        >
          Detener
        </button>
        <button onClick={() => descargar(filas, elegidos.length * nCorridas)} disabled={filas.length === 0}>
          Descargar lo que hay (JSON)
        </button>
      </div>

      {faltantes.length > 0 && (
        <p style={{ color: "crimson" }}>Faltan archivos para: {faltantes.join(", ")}.</p>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p>
        Avance: {filas.length}
        {total > 0 ? ` de ${total}` : ""} filas en el log.
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["Control", "Corrida", "Tipo de cambio", "Cita v1", "Cita v2", "ms", "Error"].map((h) => (
              <th key={h} style={{ ...celda, textAlign: "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((r, i) => (
            <tr key={i}>
              <td style={celda}>{r.controlId}</td>
              <td style={celda}>{r.corrida}</td>
              <td style={celda}>{r.tipoCambio ?? "—"}</td>
              <td style={celda}>{marcaCita(r.citaV1)}</td>
              <td style={celda}>{marcaCita(r.citaV2)}</td>
              <td style={celda}>{r.ms}</td>
              <td style={{ ...celda, color: "crimson" }}>{r.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
