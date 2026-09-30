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
// Tope por cantidad, no por tiempo (mismo motivo que stream-errors.ts: sin TTL a propósito) — 300 en vez del
// original 500 porque ahora se registra CADA invocación, no solo las que superan un umbral, así que la lista
// rota más rápido.
const MAX_REGISTROS = 300;

export type RegistroDuracion = {
  ruta: string;
  ms: number;
  timestamp: string;
};

/**
 * Registro propio e independiente de los logs de Vercel, mismo patrón que stream-errors.ts (Redis, sin TTL a
 * propósito: en el plan Hobby los logs de Vercel expiran a la hora y los Log Drains están bloqueados). A
 * diferencia de ese archivo, esto no registra errores sino duración real de CADA invocación de un paso — sin
 * umbral: sin credenciales de Redis locales no hay forma de comprobar desde el sandbox que el registro
 * realmente escribe, y una lista vacía sería ambigua (¿nadie corrió un paso lento, o el registro no
 * funciona?) si solo se guardaran los casos lentos. Registrando todo, cualquier corrida real deja al menos
 * una entrada — confirma por sí sola que el mecanismo funciona.
 */
export async function registrarDuracion(ruta: string, ms: number): Promise<void> {
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
export async function listarDuraciones(): Promise<RegistroDuracion[]> {
  return getRedis().lrange<RegistroDuracion>(LISTA_KEY, 0, -1);
}
