import { Redis } from "@upstash/redis";
import type { MejoraSesion } from "./types";

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

// Clave compuesta (análisis + explicación) en vez de un índice aparte: la lista de explicaciones Frágiles de
// un análisis ya vive en su propio registro (AnalisisGuardado.explicaciones/.veredictos), así que no hace falta
// mantener un índice separado solo para poder listar qué sesiones de Mejora tiene un análisis — un mget sobre
// esos IDs ya conocidos alcanza (ver obtenerMejoraSesiones).
function sesionKey(analisisId: string, explicacionId: string): string {
  return `agente-deutsch:mejora:${analisisId}:${explicacionId}`;
}

export async function obtenerMejoraSesion(
  analisisId: string,
  explicacionId: string
): Promise<MejoraSesion | null> {
  return getRedis().get<MejoraSesion>(sesionKey(analisisId, explicacionId));
}

/** Trae de una sola vez las sesiones existentes de varias explicaciones del mismo análisis (para pintar el
 * selector de pestañas con su marca de "ya aplicado" sin una lectura por pestaña). Las explicaciones sin
 * sesión todavía simplemente no aparecen en el mapa devuelto. */
export async function obtenerMejoraSesiones(
  analisisId: string,
  explicacionIds: string[]
): Promise<Map<string, MejoraSesion>> {
  if (explicacionIds.length === 0) return new Map();
  const registros = await getRedis().mget<(MejoraSesion | null)[]>(
    ...explicacionIds.map((id) => sesionKey(analisisId, id))
  );
  const mapa = new Map<string, MejoraSesion>();
  explicacionIds.forEach((id, i) => {
    const registro = registros[i];
    if (registro) mapa.set(id, registro);
  });
  return mapa;
}

/** Reemplaza el registro completo — quien llama ya construyó el objeto final (nueva sesión, intento agregado,
 * o aplicadoIntentoId actualizado). Sin lógica de negocio acá (tope de 5 intentos, cupo semanal, etc.); eso
 * vive en la ruta, igual que peekUsage/incrementUsage en usage.ts no deciden por sí solos cuándo se llaman. */
export async function guardarMejoraSesion(sesion: MejoraSesion): Promise<void> {
  await getRedis().set(sesionKey(sesion.analisisId, sesion.explicacionId), sesion);
}
