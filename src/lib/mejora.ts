import { Redis } from "@upstash/redis";
import type { MejoraSesionExplicacion, MejoraSesionPasaje } from "./types";

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

export const MAX_INTENTOS_EXPLICACION = 5;
export const MAX_INTENTOS_PASAJE = 3;

// Clave compuesta (análisis + hallazgo) en vez de un índice aparte: la lista de explicaciones Frágiles/pasajes
// que cierran el argumento de un análisis ya vive en su propio registro (AnalisisGuardado.veredictos/
// .pasajesPersuasivos), así que no hace falta mantener un índice separado solo para poder listar qué sesiones
// de Mejora tiene un análisis — un mget sobre esos IDs ya conocidos alcanza (ver las funciones "*Sesiones*").
function sesionExplicacionKey(analisisId: string, explicacionId: string): string {
  return `agente-deutsch:mejora:${analisisId}:${explicacionId}`;
}

// Segmento "pasaje:" explícito para no depender de que los prefijos de id (EX vs M) nunca colisionen — clave
// nueva, aditiva; la de explicación arriba se queda exactamente como estaba para no romper sesiones ya
// guardadas en producción.
function sesionPasajeKey(analisisId: string, pasajeId: string): string {
  return `agente-deutsch:mejora:${analisisId}:pasaje:${pasajeId}`;
}

/** Los registros guardados antes de que existiera el discriminador `tipo` no lo tienen — se normalizan acá,
 * en la lectura, en vez de correr una migración: cualquier cosa leída bajo la clave de explicación ES de tipo
 * "explicacion" por construcción (las de pasaje viven bajo una clave distinta), así que estampar el campo es
 * siempre correcto, tenga o no el dato ya el campo. */
function conTipoExplicacion(raw: unknown): MejoraSesionExplicacion | null {
  if (!raw) return null;
  return { ...(raw as object), tipo: "explicacion" } as MejoraSesionExplicacion;
}

export async function obtenerMejoraSesionExplicacion(
  analisisId: string,
  explicacionId: string
): Promise<MejoraSesionExplicacion | null> {
  const raw = await getRedis().get(sesionExplicacionKey(analisisId, explicacionId));
  return conTipoExplicacion(raw);
}

/** Trae de una sola vez las sesiones existentes de varias explicaciones del mismo análisis (para pintar el
 * selector de pestañas con su marca de "ya aplicado" sin una lectura por pestaña). Las explicaciones sin
 * sesión todavía simplemente no aparecen en el mapa devuelto. */
export async function obtenerMejoraSesionesExplicacion(
  analisisId: string,
  explicacionIds: string[]
): Promise<Map<string, MejoraSesionExplicacion>> {
  if (explicacionIds.length === 0) return new Map();
  const registros = await getRedis().mget<unknown[]>(
    ...explicacionIds.map((id) => sesionExplicacionKey(analisisId, id))
  );
  const mapa = new Map<string, MejoraSesionExplicacion>();
  explicacionIds.forEach((id, i) => {
    const sesion = conTipoExplicacion(registros[i]);
    if (sesion) mapa.set(id, sesion);
  });
  return mapa;
}

/** Reemplaza el registro completo — quien llama ya construyó el objeto final (nueva sesión, intento agregado,
 * o aplicadoIntentoId actualizado). Sin lógica de negocio acá (tope de intentos, cupo semanal, etc.); eso vive
 * en la ruta, igual que peekUsage/incrementUsage en usage.ts no deciden por sí solos cuándo se llaman. */
export async function guardarMejoraSesionExplicacion(sesion: MejoraSesionExplicacion): Promise<void> {
  await getRedis().set(sesionExplicacionKey(sesion.analisisId, sesion.explicacionId), sesion);
}

export async function obtenerMejoraSesionPasaje(
  analisisId: string,
  pasajeId: string
): Promise<MejoraSesionPasaje | null> {
  return getRedis().get<MejoraSesionPasaje>(sesionPasajeKey(analisisId, pasajeId));
}

export async function obtenerMejoraSesionesPasaje(
  analisisId: string,
  pasajeIds: string[]
): Promise<Map<string, MejoraSesionPasaje>> {
  if (pasajeIds.length === 0) return new Map();
  const registros = await getRedis().mget<(MejoraSesionPasaje | null)[]>(
    ...pasajeIds.map((id) => sesionPasajeKey(analisisId, id))
  );
  const mapa = new Map<string, MejoraSesionPasaje>();
  pasajeIds.forEach((id, i) => {
    const registro = registros[i];
    if (registro) mapa.set(id, registro);
  });
  return mapa;
}

export async function guardarMejoraSesionPasaje(sesion: MejoraSesionPasaje): Promise<void> {
  await getRedis().set(sesionPasajeKey(sesion.analisisId, sesion.pasajeId), sesion);
}
