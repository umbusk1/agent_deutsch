import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import type { Comparacion } from "./types";

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

function comparacionKey(id: string): string {
  return `agente-deutsch:comparacion:${id}`;
}

type GuardarComparacionInput = Omit<Comparacion, "id" | "creadoEn">;

/** Sin índice global: a diferencia de los análisis, nada en el alcance actual necesita listar todas las
 * comparaciones — solo se accede a una por su id, devuelto al terminar de correrla. */
export async function guardarComparacion(input: GuardarComparacionInput): Promise<Comparacion> {
  const registro: Comparacion = {
    ...input,
    id: randomUUID(),
    creadoEn: new Date().toISOString(),
  };
  await getRedis().set(comparacionKey(registro.id), registro);
  return registro;
}

export async function obtenerComparacion(id: string): Promise<Comparacion | null> {
  return getRedis().get<Comparacion>(comparacionKey(id));
}
