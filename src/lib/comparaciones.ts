import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import type { Comparacion } from "./types";
import { obtenerAnalisis, iniciales } from "./analisis";
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

const INDEX_KEY = "agente-deutsch:comparacion:index";

function comparacionKey(id: string): string {
  return `agente-deutsch:comparacion:${id}`;
}

export type ComparacionResumen = {
  id: string;
  analisisAId: string;
  analisisBId: string;
  tituloA: string;
  tituloB: string;
  mismoProblema: boolean;
  creadoPor: string;
  iniciales: string;
  creadoEn: string;
};

type GuardarComparacionInput = Omit<Comparacion, "id" | "creadoEn">;

export async function guardarComparacion(input: GuardarComparacionInput): Promise<Comparacion> {
  const registro: Comparacion = {
    ...input,
    id: randomUUID(),
    creadoEn: new Date().toISOString(),
  };
  await getRedis().set(comparacionKey(registro.id), registro);
  // Indexada por cuándo se corrió (no hay una "fecha de publicación" propia de una comparación, a
  // diferencia de un análisis) — más reciente primero, mismo criterio que Biblioteca ya usa para análisis.
  await getRedis().zadd(INDEX_KEY, { score: Date.parse(registro.creadoEn), member: registro.id });
  return registro;
}

export async function obtenerComparacion(id: string): Promise<Comparacion | null> {
  return getRedis().get<Comparacion>(comparacionKey(id));
}

export async function eliminarComparacion(id: string): Promise<void> {
  await getRedis().del(comparacionKey(id));
  await getRedis().zrem(INDEX_KEY, id);
}

/** Lista para la pestaña "Comparaciones" de Biblioteca: más reciente primero, con los títulos de ambos
 * análisis ya resueltos (un análisis pudo haber sido eliminado después de compararlo — se muestra un
 * marcador en vez de fallar toda la lista). */
export async function listarComparaciones(): Promise<ComparacionResumen[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
  if (ids.length === 0) return [];

  const registros = await redis.mget<Comparacion[]>(...ids.map(comparacionKey));
  const validos = registros.filter((r): r is Comparacion => r !== null);

  const analisisIds = [...new Set(validos.flatMap((r) => [r.analisisAId, r.analisisBId]))];
  const analisisEncontrados = await Promise.all(analisisIds.map((id) => obtenerAnalisis(id)));
  const titulos = new Map(
    analisisEncontrados.map((a, i) => [analisisIds[i], a?.metaTitulo || "(análisis eliminado)"])
  );

  return validos.map((r) => ({
    id: r.id,
    analisisAId: r.analisisAId,
    analisisBId: r.analisisBId,
    tituloA: titulos.get(r.analisisAId) ?? "(análisis eliminado)",
    tituloB: titulos.get(r.analisisBId) ?? "(análisis eliminado)",
    mismoProblema: r.mismoProblema,
    creadoPor: r.creadoPor,
    iniciales: iniciales(findUser(r.creadoPor)?.fullName, r.creadoPor),
    creadoEn: r.creadoEn,
  }));
}
