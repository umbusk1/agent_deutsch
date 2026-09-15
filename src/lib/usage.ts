import { Redis } from "@upstash/redis";

const WEEK_TTL_SECONDS = 9 * 24 * 60 * 60;

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

function mondayOf(date: Date): string {
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday)
  );
  return monday.toISOString().slice(0, 10);
}

/** El identificador de la semana actual (lunes ISO, UTC) — el mismo que usan las claves de cuota. */
export function currentWeekId(): string {
  return mondayOf(new Date());
}

function usageKey(username: string, weekId: string): string {
  return `agente-deutsch:usage:${username}:${weekId}`;
}

export async function peekUsage(username: string, weekId: string = currentWeekId()): Promise<number> {
  const value = await getRedis().get<number>(usageKey(username, weekId));
  return value ?? 0;
}

export async function incrementUsage(username: string): Promise<number> {
  const weekId = currentWeekId();
  const key = usageKey(username, weekId);
  const count = await getRedis().incr(key);
  if (count === 1) {
    await getRedis().expire(key, WEEK_TTL_SECONDS);
  }
  return count;
}

/** Resta 1 uso a una semana específica (no necesariamente la actual) — usado al aprobar una apelación. */
export async function restoreUsage(username: string, weekId: string): Promise<number> {
  const key = usageKey(username, weekId);
  const current = await getRedis().get<number>(key);
  if (!current || current <= 0) return 0;
  const next = await getRedis().decr(key);
  if (next < 0) {
    await getRedis().set(key, 0);
    return 0;
  }
  return next;
}

/** Marca un token de restauración como usado. Devuelve true solo la primera vez (protege contra doble clic). */
export async function markRestoreTokenUsed(token: string): Promise<boolean> {
  const key = `agente-deutsch:restore-used:${token}`;
  const result = await getRedis().set(key, "1", { nx: true, ex: WEEK_TTL_SECONDS });
  return result === "OK";
}
