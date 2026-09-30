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

const LISTA_KEY = "agente-deutsch:step-timings";
// Mismo motivo que MAX_REGISTROS en stream-errors.ts: sin TTL a propósito (ver registrarSiTardaMucho), así
// que el tope es por cantidad, no por tiempo.
const MAX_REGISTROS = 500;

// 45s: el umbral que nos interesa medir, no un límite técnico — está por debajo de los 60s del techo real ya
// confirmado en producción (ver project_vercel_infra_notes.md), para tener aviso antes de llegar a ese techo.
const UMBRAL_MS = 45_000;

export type RegistroDuracion = {
  ruta: string;
  ms: number;
  timestamp: string;
};

/**
 * Registro propio e independiente de los logs de Vercel, mismo patrón que stream-errors.ts (Redis, sin TTL a
 * propósito: en el plan Hobby los logs de Vercel expiran a la hora y los Log Drains están bloqueados). A
 * diferencia de ese archivo, esto no registra errores sino duración real — para tener datos concretos de
 * cuánto tardan los pasos de la corrida en vez de analogías entre rutas al decidir maxDuration. Solo se
 * persiste si supera UMBRAL_MS; no es un log de cada invocación.
 */
export async function registrarSiTardaMucho(ruta: string, ms: number): Promise<void> {
  if (ms < UMBRAL_MS) return;
  try {
    const registro: RegistroDuracion = { ruta, ms, timestamp: new Date().toISOString() };
    await getRedis().lpush(LISTA_KEY, registro);
    await getRedis().ltrim(LISTA_KEY, 0, MAX_REGISTROS - 1);
  } catch (logError) {
    // Si Redis mismo falla no hay otro lugar donde dejar constancia salvo el log de la plataforma.
    console.error("[step-timings] no se pudo persistir el registro:", logError);
  }
}

/** Más reciente primero (lpush inserta al principio de la lista). */
export async function listarDuracionesLargas(): Promise<RegistroDuracion[]> {
  return getRedis().lrange<RegistroDuracion>(LISTA_KEY, 0, -1);
}
