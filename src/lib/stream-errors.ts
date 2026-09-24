import { Redis } from "@upstash/redis";

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

const LISTA_KEY = "agente-deutsch:stream-errors";
// Tope por cantidad, no por tiempo: a propósito no hay TTL acá (ver registrarErrorDeStream), así que sin
// esto la lista crecería sin límite.
const MAX_REGISTROS = 500;

export type ErrorDeStream = {
  ruta: string;
  mensaje: string;
  timestamp: string;
};

/**
 * Registro propio e independiente de los logs de Vercel para errores de streaming en las rutas SSE
 * (step1, step7). En el plan Hobby los logs de Vercel expiran a la hora y los Log Drains (que lo
 * extenderían) están bloqueados, así que este registro no lleva TTL a propósito: es la única forma de
 * consultar después si uno de estos errores ocurrió.
 */
export async function registrarErrorDeStream(ruta: string, error: unknown): Promise<void> {
  try {
    const registro: ErrorDeStream = {
      ruta,
      mensaje: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
    await getRedis().lpush(LISTA_KEY, registro);
    await getRedis().ltrim(LISTA_KEY, 0, MAX_REGISTROS - 1);
  } catch (logError) {
    // Si Redis mismo falla no hay otro lugar donde dejar constancia salvo el log de la plataforma.
    console.error("[stream-errors] no se pudo persistir el registro:", logError);
  }
}

/** Más reciente primero (lpush inserta al principio de la lista). */
export async function listarErroresDeStream(): Promise<ErrorDeStream[]> {
  return getRedis().lrange<ErrorDeStream>(LISTA_KEY, 0, -1);
}
