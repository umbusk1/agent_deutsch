import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import type {
  Problema,
  Explicacion,
  Veredicto,
  ProblemaNuevo,
  Relacion,
  Alcance,
  PasajePersuasivo,
} from "./types";
import { findUser } from "./users";
import { obtenerMejoraSesiones } from "./mejora";
import { tieneCambioAplicado } from "./textoV2";

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
  /** Solo presentes si alguien editó la metadata después de guardar — sin historial, solo el último editor. */
  editadoPor?: string;
  editadoEn?: string;
  /**
   * Datos completos de la corrida, para poder regenerar el reporte (Paso 7) sin volver a correr todo el
   * análisis. Opcionales y ausentes en los registros guardados antes de este campo (ej. corridas de Ronda 2) —
   * cualquier lectura de estos campos debe asumir que pueden faltar, nunca que siempre están presentes. Se
   * guardan los tipos completos ya existentes (no una forma recortada a lo que step7 usa hoy) para no quedar
   * desincronizados si el consumo de estos datos cambia más adelante.
   */
  texto?: string;
  problemas?: Problema[];
  explicaciones?: Explicacion[];
  veredictos?: Veredicto[];
  problemasNuevos?: ProblemaNuevo[];
  relaciones?: Relacion[];
  alcances?: Alcance[];
  pasajesPersuasivos?: PasajePersuasivo[];
};

export type AnalisisResumen = {
  id: string;
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
  usuario: string;
  iniciales: string;
  totalProblemas: number;
  problemasConExplicacion: number;
  /** Explicaciones con veredicto FacilDeVariar de este análisis que todavía no tienen un intento de Mejora
   * aplicado — calculado en cada lectura de la lista (no en el guardado, a diferencia de 3P/3E) porque depende
   * de sesiones de Mejora que se crean después, potencialmente mucho después, de guardar el análisis. */
  explicacionesMejorables: number;
  /** Si al menos una explicación tiene un intento de Mejora aplicado — es decir, si TextoV2 existe para este
   * análisis. Nunca se persiste aparte: se deriva de las mismas sesiones de Mejora que ya se consultan para
   * explicacionesMejorables (ver ensamblarTextoV2/tieneCambioAplicado en textoV2.ts). */
  tieneTextoV2: boolean;
  creadoEn: string;
  editadoPor?: string;
  editadoEn?: string;
};

export function iniciales(nombreCompleto: string | undefined, fallback: string): string {
  const fuente = nombreCompleto?.trim() || fallback;
  const partes = fuente.split(/\s+/).filter(Boolean);
  const primera = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primera + ultima).toUpperCase();
}

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
  // Opcionales: el resto de los datos completos de la corrida (ver el comentario junto a estos mismos
  // campos en AnalisisGuardado). Si no vienen, el registro queda igual que antes de este cambio.
  texto?: string;
  veredictos?: Veredicto[];
  problemasNuevos?: ProblemaNuevo[];
  relaciones?: Relacion[];
  alcances?: Alcance[];
  pasajesPersuasivos?: PasajePersuasivo[];
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
    ...(input.texto !== undefined ? { texto: input.texto } : {}),
    problemas: input.problemas,
    explicaciones: input.explicaciones,
    ...(input.veredictos !== undefined ? { veredictos: input.veredictos } : {}),
    ...(input.problemasNuevos !== undefined ? { problemasNuevos: input.problemasNuevos } : {}),
    ...(input.relaciones !== undefined ? { relaciones: input.relaciones } : {}),
    ...(input.alcances !== undefined ? { alcances: input.alcances } : {}),
    ...(input.pasajesPersuasivos !== undefined ? { pasajesPersuasivos: input.pasajesPersuasivos } : {}),
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

/** Lista para la Biblioteca: más reciente primero por fecha de PUBLICACIÓN (mismo criterio que el índice
 * de guardarAnalisis), sin los campos pesados (reporte/tripletas) que solo hacen falta al ver el detalle. */
export async function listarAnalisis(): Promise<AnalisisResumen[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
  if (ids.length === 0) return [];

  const registros = await redis.mget<AnalisisGuardado[]>(...ids.map(analisisKey));
  const validos = registros.filter((r): r is AnalisisGuardado => r !== null);

  return Promise.all(
    validos.map(async (r) => {
      const fragilIds = (r.veredictos ?? [])
        .filter((v) => v.veredicto === "FacilDeVariar")
        .map((v) => v.explicacionId);

      // Solo las explicaciones Frágiles pueden tener alguna vez una sesión de Mejora (la ruta de evaluar
      // rechaza cualquier otro veredicto), así que consultar solo fragilIds ya cubre TODAS las sesiones
      // posibles de este análisis — no hace falta una segunda consulta aparte para tieneTextoV2.
      let explicacionesMejorables = 0;
      let tieneTextoV2 = false;
      if (fragilIds.length > 0) {
        const sesiones = await obtenerMejoraSesiones(r.id, fragilIds);
        explicacionesMejorables = fragilIds.filter((id) => {
          const sesion = sesiones.get(id);
          return !sesion || sesion.aplicadoIntentoId === null;
        }).length;
        tieneTextoV2 = tieneCambioAplicado(sesiones.values());
      }

      return {
        id: r.id,
        metaFecha: r.metaFecha,
        metaAutor: r.metaAutor,
        metaMedio: r.metaMedio,
        metaTitulo: r.metaTitulo,
        usuario: r.usuario,
        iniciales: iniciales(findUser(r.usuario)?.fullName, r.usuario),
        totalProblemas: r.totalProblemas,
        problemasConExplicacion: r.problemasConExplicacion,
        explicacionesMejorables,
        tieneTextoV2,
        creadoEn: r.creadoEn,
        editadoPor: r.editadoPor,
        editadoEn: r.editadoEn,
      };
    })
  );
}

export async function obtenerAnalisis(id: string): Promise<AnalisisGuardado | null> {
  return getRedis().get<AnalisisGuardado>(analisisKey(id));
}

export async function eliminarAnalisis(id: string): Promise<void> {
  await getRedis().del(analisisKey(id));
  await getRedis().zrem(INDEX_KEY, id);
}

type ActualizarAnalisisInput = {
  metaFecha: string;
  metaAutor: string;
  metaMedio: string;
  metaTitulo: string;
};

/**
 * Edita metadata de un análisis ya guardado (no el reporte ni las explicaciones). Si metaFecha cambia, el
 * índice se reordena automáticamente: zadd con el mismo member actualiza su score en vez de duplicarlo, así
 * que el acordeón de Biblioteca reubica el análisis en su nuevo grupo de mes sin ningún paso adicional.
 */
export async function actualizarAnalisis(
  id: string,
  input: ActualizarAnalisisInput,
  editadoPor: string
): Promise<AnalisisGuardado | null> {
  const existente = await obtenerAnalisis(id);
  if (!existente) return null;

  const registro: AnalisisGuardado = {
    ...existente,
    metaFecha: input.metaFecha.trim(),
    metaAutor: input.metaAutor.trim(),
    metaMedio: input.metaMedio.trim(),
    metaTitulo: input.metaTitulo.trim(),
    editadoPor,
    editadoEn: new Date().toISOString(),
  };

  await getRedis().set(analisisKey(id), registro);

  const fechaPublicacion = Date.parse(registro.metaFecha);
  const score = Number.isNaN(fechaPublicacion) ? Date.parse(registro.creadoEn) : fechaPublicacion;
  await getRedis().zadd(INDEX_KEY, { score, member: id });

  return registro;
}
