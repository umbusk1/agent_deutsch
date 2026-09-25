import { Redis } from "@upstash/redis";

const WEEK_TTL_SECONDS = 9 * 24 * 60 * 60;

/** Cupo semanal de comparaciones para usuarios no-admin — fijo, no configurable por usuario, y separado
 * por completo del cupo de análisis (contador distinto, ver usageKey). Los admin no lo consumen. */
export const COMPARACION_LIMIT_SEMANAL = 2;

/** Cupo semanal de TEXTOS (no de intentos ni de sesiones) para Mejora — fijo, no configurable por usuario. */
export const MEJORA_TEXTOS_LIMIT_SEMANAL = 2;

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

// "analisis" mantiene el formato de clave original (sin prefijo) para no resetear contadores ya activos;
// cualquier otro "kind" (ej. "comparacion") usa su propio contador, separado del de análisis.
function usageKey(username: string, weekId: string, kind: string = "analisis"): string {
  return kind === "analisis"
    ? `agente-deutsch:usage:${username}:${weekId}`
    : `agente-deutsch:usage:${kind}:${username}:${weekId}`;
}

export async function peekUsage(
  username: string,
  weekId: string = currentWeekId(),
  kind: string = "analisis"
): Promise<number> {
  const value = await getRedis().get<number>(usageKey(username, weekId, kind));
  return value ?? 0;
}

export async function incrementUsage(username: string, kind: string = "analisis"): Promise<number> {
  const weekId = currentWeekId();
  const key = usageKey(username, weekId, kind);
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

// El cupo de Mejora es de MEMBRESÍA, no de conteo: reabrir un texto ya desbloqueado esta semana (para trabajar
// otra explicación, u otro intento) no gasta cupo — solo el primer texto nuevo lo gasta. Por eso es un SET de
// analisisId por usuario/semana, no un INCR como el resto de usage.ts.
function mejoraTextosKey(username: string, weekId: string): string {
  return `agente-deutsch:usage:mejora-textos:${username}:${weekId}`;
}

export async function estaTextoDesbloqueado(
  username: string,
  analisisId: string,
  weekId: string = currentWeekId()
): Promise<boolean> {
  const result = await getRedis().sismember(mejoraTextosKey(username, weekId), analisisId);
  return result === 1;
}

export async function textosDesbloqueadosEstaSemana(
  username: string,
  weekId: string = currentWeekId()
): Promise<number> {
  return getRedis().scard(mejoraTextosKey(username, weekId));
}

/**
 * Intenta desbloquear un texto para Mejora esta semana. Si ese analisisId ya estaba desbloqueado, es
 * idempotente (no gasta cupo ni error) — el gasto real es solo por texto NUEVO. Devuelve false si el texto es
 * nuevo y el cupo semanal (MEJORA_TEXTOS_LIMIT_SEMANAL) ya se agotó; la ruta decide qué hacer con ese false
 * (ej. responder 429), igual que step1 decide qué hacer con peekUsage antes de llamar a incrementUsage.
 *
 * Nota: como en el resto de usage.ts, el chequeo y la escritura no son atómicos entre sí (SISMEMBER/SCARD
 * seguidos de SADD) — mismo nivel de tolerancia a condiciones de carrera que ya acepta incrementUsage/
 * peekUsage en este archivo, no un estándar nuevo introducido acá.
 */
export async function desbloquearTextoMejora(
  username: string,
  analisisId: string,
  weekId: string = currentWeekId()
): Promise<boolean> {
  const key = mejoraTextosKey(username, weekId);
  const redis = getRedis();

  const yaEstaba = await redis.sismember(key, analisisId);
  if (yaEstaba === 1) return true;

  const actuales = await redis.scard(key);
  if (actuales >= MEJORA_TEXTOS_LIMIT_SEMANAL) return false;

  await redis.sadd(key, analisisId);
  if (actuales === 0) {
    // Solo hace falta poner el TTL la primera vez que la clave pasa a existir — SADD no lo reinicia, así que
    // chequear el tamaño ANTES de agregar evita pisar el TTL de una clave que ya estaba viva.
    await redis.expire(key, WEEK_TTL_SECONDS);
  }
  return true;
}
