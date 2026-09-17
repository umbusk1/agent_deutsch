"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AnalisisResumen } from "@/lib/analisis";

type Identidad = { username: string; fullName?: string; isAdmin: boolean };

type Quota = {
  unlimited: boolean;
  limit?: number;
  used?: number;
  remaining?: number;
};

type Grupo = { key: string; label: string; items: AnalisisResumen[] };

function monthKeyDe(item: AnalisisResumen): string {
  const fecha = item.metaFecha?.trim();
  const parsed = fecha && !Number.isNaN(Date.parse(fecha)) ? new Date(fecha) : new Date(item.creadoEn);
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelDe(key: string): string {
  const [year, month] = key.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, 1));
  const label = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(fecha);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function agruparPorMes(analisis: AnalisisResumen[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const item of analisis) {
    const key = monthKeyDe(item);
    if (!grupos.has(key)) {
      grupos.set(key, { key, label: monthLabelDe(key), items: [] });
    }
    grupos.get(key)!.items.push(item);
  }
  return [...grupos.values()];
}

export default function Biblioteca() {
  const router = useRouter();

  const [analisis, setAnalisis] = useState<AnalisisResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identidad, setIdentidad] = useState<Identidad | null>(null);
  const [cupoComparaciones, setCupoComparaciones] = useState<Quota | null>(null);

  const [expandedMonths, setExpandedMonths] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analisis")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setAnalisis(data.analisis);
      })
      .catch(() => setError("No se pudo cargar la biblioteca."));

    fetch("/api/usage")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setIdentidad({ username: data.username, fullName: data.fullName, isAdmin: Boolean(data.isAdmin) });
      })
      .catch(() => {});

    fetch("/api/usage?tipo=comparacion")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setCupoComparaciones(data);
      })
      .catch(() => {});
  }, []);

  const grupos = useMemo(() => (analisis ? agruparPorMes(analisis) : []), [analisis]);

  function toggleMonth(key: string) {
    setExpandedMonths((prev) => {
      // Sin tocar todavía: el default es solo el mes más reciente expandido, calculado acá (no en un
      // efecto) para no disparar un setState en cascada al montar.
      const base = prev ?? (grupos[0] ? new Set([grupos[0].key]) : new Set<string>());
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  }

  async function confirmarEliminar(id: string) {
    setDeleteError(null);
    try {
      const res = await fetch(`/api/analisis/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error inesperado.");
      setAnalisis((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "No se pudo eliminar el análisis.");
    } finally {
      setDeletingId(null);
    }
  }

  async function compararSeleccionados() {
    const [analisisAId, analisisBId] = [...selected];
    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch("/api/comparacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analisisAId, analisisBId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error inesperado.");
      router.push(`/comparacion/${data.id}`);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : "No se pudo comparar los análisis seleccionados.");
      setComparing(false);
    }
  }

  const comparacionAgotada =
    cupoComparaciones && !cupoComparaciones.unlimited && (cupoComparaciones.remaining ?? 0) <= 0;

  return (
    <div className="container">
      <div className="header">
        <h1>Agente Deutsch</h1>
        <p>Biblioteca de análisis críticos ya realizados.</p>
      </div>

      <div className="actions" style={{ justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <Link href="/nuevo">
          <button className="primary">+ Nuevo análisis</button>
        </Link>
        {cupoComparaciones && (
          <span className="loading">
            {cupoComparaciones.unlimited
              ? "Comparaciones ilimitadas (admin)"
              : `Te quedan ${cupoComparaciones.remaining} de ${cupoComparaciones.limit} comparaciones esta semana.`}
          </span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {deleteError && <div className="error-banner">{deleteError}</div>}
      {compareError && <div className="error-banner">{compareError}</div>}

      {analisis === null && !error && <p className="loading">Cargando biblioteca...</p>}
      {analisis !== null && analisis.length === 0 && (
        <div className="card">
          <p>Todavía no hay análisis guardados.</p>
        </div>
      )}

      {grupos.map((grupo) => {
        const expandido = expandedMonths ? expandedMonths.has(grupo.key) : grupo.key === grupos[0]?.key;
        return (
          <div key={grupo.key} className="card">
            <button
              onClick={() => toggleMonth(grupo.key)}
              className="biblioteca-mes"
              aria-expanded={expandido}
            >
              <span>{expandido ? "▾" : "▸"} {grupo.label}</span>
              <span className="badge">{grupo.items.length}</span>
            </button>

            {expandido &&
              grupo.items.map((item) => (
                <div key={item.id} className="item biblioteca-fila">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={!selected.has(item.id) && selected.size >= 2}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={`Seleccionar ${item.metaTitulo || "análisis"} para comparar`}
                  />
                  <span className="avatar" title={item.usuario}>{item.iniciales}</span>
                  <div className="biblioteca-fila-info">
                    <div>{item.metaTitulo || "(sin título)"}</div>
                    <div className="item-label" style={{ marginBottom: 0 }}>
                      <span>
                        {[item.metaAutor, item.metaMedio, item.metaFecha].filter(Boolean).join(" · ") || "Sin metadatos"}
                      </span>
                    </div>
                  </div>
                  <span className="badge">{item.totalProblemas}P/{item.problemasConExplicacion}E</span>
                  <Link href={`/analisis/${item.id}`}>
                    <button>Ver reporte</button>
                  </Link>
                  {identidad?.isAdmin &&
                    (deletingId === item.id ? (
                      <span className="actions" style={{ margin: 0 }}>
                        <button onClick={() => setDeletingId(null)}>Cancelar</button>
                        <button onClick={() => confirmarEliminar(item.id)}>Confirmar</button>
                      </span>
                    ) : (
                      <button onClick={() => setDeletingId(item.id)} aria-label="Eliminar">
                        🗑
                      </button>
                    ))}
                </div>
              ))}
          </div>
        );
      })}

      {analisis !== null && analisis.length > 0 && (
        <div className="actions">
          <button
            className="primary"
            disabled={selected.size !== 2 || comparing || Boolean(comparacionAgotada)}
            onClick={compararSeleccionados}
          >
            {comparing ? "Comparando..." : "Comparar seleccionados"}
          </button>
        </div>
      )}
    </div>
  );
}
