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

const LISTA_KEY = "agente-deutsch:nota-mentor-rechazos";
// Mismo patrón que stream-errors.ts: sin TTL a propósito (logs de Vercel expiran a la hora en el plan
// Hobby), tope por cantidad en su lugar.
const MAX_REGISTROS = 300;

export type NotaMentorRechazada = {
  ruta: string;
  motivo: string;
  // Primeros 200 caracteres de la nota rechazada — alcanza para diagnosticar sin guardar la nota completa.
  notaRechazada: string;
  timestamp: string;
};

/**
 * Registro de cada vez que el aviso explícito de "nota no verificada" se le mostró al usuario — es decir,
 * cuando la nota de mentor siguió fallando la verificación (voseo o caracteres anómalos, ver
 * nota-mentor-validacion.ts) incluso DESPUÉS del reintento con el problema señalado. No se registra el primer
 * intento fallido (ese se resuelve solo con el reintento) — solo el caso final que el usuario llega a ver.
 */
export async function registrarNotaMentorRechazada(ruta: string, motivo: string, nota: string): Promise<void> {
  try {
    const registro: NotaMentorRechazada = {
      ruta,
      motivo,
      notaRechazada: nota.slice(0, 200),
      timestamp: new Date().toISOString(),
    };
    await getRedis().lpush(LISTA_KEY, registro);
    await getRedis().ltrim(LISTA_KEY, 0, MAX_REGISTROS - 1);
  } catch (logError) {
    console.error("[nota-mentor-rechazos] no se pudo persistir el registro:", logError);
  }
}

/** Más reciente primero (lpush inserta al principio de la lista). */
export async function listarNotasMentorRechazadas(): Promise<NotaMentorRechazada[]> {
  return getRedis().lrange<NotaMentorRechazada>(LISTA_KEY, 0, -1);
}
