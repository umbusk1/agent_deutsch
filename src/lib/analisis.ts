import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import type { Problema, Explicacion } from "./types";
import { findUser } from "./users";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error("No se encontraron las credenciales REST de Upstash Redis en las variables de entorno.");
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

const INDEX_KEY = "agente-deutsch:analisis:index";

function analisisKey(id: string): string {
  return `agente-deutsch:analisis:${id}`;
}

export type AnalisisGuardado = {
  id: string;
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
  usuario: string;
  reporte: string;
  tripletas: string;
  totalProblemas: number;
  problemasConExplicacion: number;
  creadoEn: string;
};

export type AnalisisResumen = {
  id: string;
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
  usuario: string;
  iniciales: string;
  totalProblemas: number;
  problemasConExplicacion: number;
  creadoEn: string;
};

function iniciales(nombreCompleto: string | undefined, fallback: string): string {
  const fuente = nombreCompleto?.trim() || fallback;
  const partes = fuente.split(/\s+/).filter(Boolean);
  const primera = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primera + ultima).toUpperCase();
}

type GuardarAnalisisInput = {
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
  usuario: string;
  reporte: string;
  tripletas: string;
  problemas: Problema[];
  explicaciones: Explicacion[];
};

/**
 * Guarda un análisis completo y devuelve su registro (incluyendo el id estable asignado).
 * La caracterización "3P/3E" se calcula aquí, una sola vez, no en cada lectura posterior.
 */
export async function guardarAnalisis(input: GuardarAnalisisInput): Promise<AnalisisGuardado> {
  const totalProblemas = input.problemas.length;
  const problemasConId = new Set(input.problemas.map((p) => p.id));
  const problemasConExplicacion = new Set(
    input.explicaciones.map((e) => e.problemaId).filter((id) => problemasConId.has(id))
  ).size;

  const registro: AnalisisGuardado = {
    id: randomUUID(),
    metaFecha: input.metaFecha.trim(),
    metaAutor: input.metaAutor.trim(),
    metaMedio: input.metaMedio.trim(),
    metaTitulo: input.metaTitulo.trim(),
    usuario: input.usuario,
    reporte: input.reporte,
    tripletas: input.tripletas,
    totalProblemas,
    problemasConExplicacion,
    creadoEn: new Date().toISOString(),
  };

  await getRedis().set(analisisKey(registro.id), registro);
  // El acordeón de la Biblioteca agrupa por mes de PUBLICACIÓN (metaFecha), no por cuándo se corrió el
  // análisis — así que el índice ordena por esa fecha. metaFecha es un campo manual opcional y de texto
  // libre; si falta o no es una fecha reconocible, se usa creadoEn como respaldo para no perder el registro
  // del índice, pero quedará agrupado por la fecha de análisis en vez de la de publicación en ese caso.
  const fechaPublicacion = Date.parse(registro.metaFecha);
  const score = Number.isNaN(fechaPublicacion) ? Date.parse(registro.creadoEn) : fechaPublicacion;
  await getRedis().zadd(INDEX_KEY, { score, member: registro.id });

  return registro;
}

/** Lista para la Biblioteca: más reciente primero por fecha de PUBLICACIÓN (mismo criterio que el índice
 * de guardarAnalisis), sin los campos pesados (reporte/tripletas) que solo hacen falta al ver el detalle. */
export async function listarAnalisis(): Promise<AnalisisResumen[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
  if (ids.length === 0) return [];

  const registros = await redis.mget<AnalisisGuardado[]>(...ids.map(analisisKey));

  return registros
    .filter((r): r is AnalisisGuardado => r !== null)
    .map((r) => ({
      id: r.id,
      metaFecha: r.metaFecha,
      metaAutor: r.metaAutor,
      metaMedio: r.metaMedio,
      metaTitulo: r.metaTitulo,
      usuario: r.usuario,
      iniciales: iniciales(findUser(r.usuario)?.fullName, r.usuario),
      totalProblemas: r.totalProblemas,
      problemasConExplicacion: r.problemasConExplicacion,
      creadoEn: r.creadoEn,
    }));
}

export async function obtenerAnalisis(id: string): Promise<AnalisisGuardado | null> {
  return getRedis().get<AnalisisGuardado>(analisisKey(id));
}

export async function eliminarAnalisis(id: string): Promise<void> {
  await getRedis().del(analisisKey(id));
  await getRedis().zrem(INDEX_KEY, id);
}
