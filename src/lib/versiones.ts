import { Redis } from "@upstash/redis";
import type { ComparacionVersiones } from "./types";
import { obtenerAnalisis, type AnalisisGuardado } from "./analisis";
import { MAX_VERSIONES } from "./versiones-limites";

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

// Claves nuevas y aditivas: nada de lo que ya existe en Redis se toca.
function listaVersionesKey(raizId: string): string {
  return `agente-deutsch:versiones:${raizId}`;
}
function comparacionVersionesKey(analisisNuevoId: string): string {
  return `agente-deutsch:versiones:comparacion:${analisisNuevoId}`;
}

/** IDs de todas las versiones de un texto, en orden (la raíz primero). Si todavía no hay lista (texto sin
 * versiones), devuelve solo la raíz. */
export async function listarVersiones(raizId: string): Promise<string[]> {
  const ids = await getRedis().lrange<string>(listaVersionesKey(raizId), 0, -1);
  return ids.length > 0 ? ids : [raizId];
}

/** Agrega una versión a la lista de su texto raíz. La primera vez, la lista arranca con la raíz. */
export async function registrarVersion(raizId: string, versionId: string): Promise<void> {
  const redis = getRedis();
  const key = listaVersionesKey(raizId);
  const existentes = await redis.lrange<string>(key, 0, -1);
  if (existentes.includes(versionId)) return;
  if (existentes.length === 0) await redis.rpush(key, raizId);
  await redis.rpush(key, versionId);
}

export async function guardarComparacionVersiones(c: ComparacionVersiones): Promise<void> {
  await getRedis().set(comparacionVersionesKey(c.analisisNuevoId), c);
}

export async function obtenerComparacionVersiones(analisisNuevoId: string): Promise<ComparacionVersiones | null> {
  return getRedis().get<ComparacionVersiones>(comparacionVersionesKey(analisisNuevoId));
}

export type ResolucionVersion =
  | { ok: true; anterior: AnalisisGuardado; raizId: string; numero: number }
  | { ok: false; status: number; error: string };

/**
 * Dado el id del análisis que se quiere editar, decide si se puede crear una versión nueva a partir de él y
 * cuál sería su raíz y su número. Mismas reglas que la Mejora actual: solo el autor, sin excepción para admin;
 * el tope de MAX_VERSIONES no aplica a los admin (ilimitados, igual que su cupo).
 */
export async function resolverVersionNueva(
  anteriorId: string,
  username: string,
  esAdmin: boolean
): Promise<ResolucionVersion> {
  const anterior = await obtenerAnalisis(anteriorId);
  if (!anterior) return { ok: false, status: 404, error: "El análisis que quieres editar no existe." };
  if (anterior.usuario !== username) {
    return { ok: false, status: 403, error: "Solo el autor de un análisis puede crear una versión nueva a partir de él." };
  }
  if (!anterior.texto || !anterior.explicaciones || !anterior.problemas || !anterior.veredictos) {
    return {
      ok: false,
      status: 400,
      error: "Este análisis no tiene los datos completos que necesita una versión nueva.",
    };
  }
  const raizId = anterior.versionRaizId ?? anterior.id;
  const versiones = await listarVersiones(raizId);
  if (!esAdmin && versiones.length >= MAX_VERSIONES) {
    return {
      ok: false,
      status: 400,
      error: `Este texto ya tiene el máximo de ${MAX_VERSIONES} versiones.`,
    };
  }
  return { ok: true, anterior, raizId, numero: versiones.length + 1 };
}
