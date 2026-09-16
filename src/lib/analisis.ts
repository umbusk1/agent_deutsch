import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import type { Problema, Explicacion } from "./types";

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

const INDEX_KEY = "agente-deutsch:analisis:index";

function analisisKey(id: string): string {
  return `agente-deutsch:analisis:${id}`;
}

export type AnalisisGuardado = {
  id: string;
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
  usuario: string;
  reporte: string;
  tripletas: string;
  totalProblemas: number;
  problemasConExplicacion: number;
  creadoEn: string;
};

type GuardarAnalisisInput = {
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
  usuario: string;
  reporte: string;
  tripletas: string;
  problemas: Problema[];
  explicaciones: Explicacion[];
};

/**
 * Guarda un análisis completo y devuelve su registro (incluyendo el id estable asignado).
 * La caracterización "3P/3E" se calcula aquí, una sola vez, no en cada lectura posterior.
 */
export async function guardarAnalisis(input: GuardarAnalisisInput): Promise<AnalisisGuardado> {
  const totalProblemas = input.problemas.length;
  const problemasConId = new Set(input.problemas.map((p) => p.id));
  const problemasConExplicacion = new Set(
    input.explicaciones.map((e) => e.problemaId).filter((id) => problemasConId.has(id))
  ).size;

  const registro: AnalisisGuardado = {
    id: randomUUID(),
    metaFecha: input.metaFecha.trim(),
    metaAutor: input.metaAutor.trim(),
    metaMedio: input.metaMedio.trim(),
    metaTitulo: input.metaTitulo.trim(),
    usuario: input.usuario,
    reporte: input.reporte,
    tripletas: input.tripletas,
    totalProblemas,
    problemasConExplicacion,
    creadoEn: new Date().toISOString(),
  };

  await getRedis().set(analisisKey(registro.id), registro);
  // El acordeón de la Biblioteca agrupa por mes de PUBLICACIÓN (metaFecha), no por cuándo se corrió el
  // análisis — así que el índice ordena por esa fecha. metaFecha es un campo manual opcional y de texto
  // libre; si falta o no es una fecha reconocible, se usa creadoEn como respaldo para no perder el registro
  // del índice, pero quedará agrupado por la fecha de análisis en vez de la de publicación en ese caso.
  const fechaPublicacion = Date.parse(registro.metaFecha);
  const score = Number.isNaN(fechaPublicacion) ? Date.parse(registro.creadoEn) : fechaPublicacion;
  await getRedis().zadd(INDEX_KEY, { score, member: registro.id });

  return registro;
}
