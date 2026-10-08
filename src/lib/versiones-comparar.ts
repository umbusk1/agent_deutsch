/**
 * Lógica PURA (sin Redis, sin modelo) de la comparación entre versiones: validar lo que devuelve el modelo y
 * calcular las transiciones por explicación. Vive aparte para poder probarla con datos inventados sin gastar
 * ninguna llamada.
 */
import type {
  CambioVersion,
  Explicacion,
  TipoCambioVersion,
  TransicionExplicacion,
  Veredicto,
} from "./types";
import { verificarCita } from "./versiones-citas";

export const TIPOS_CAMBIO_VERSION: TipoCambioVersion[] = [
  "cosmetico",
  "problema",
  "explicacion_anadida",
  "explicacion_quitada",
  "contenido_sin_explicacion",
  "afirmacion_modificada",
];

export type CambioCrudo = {
  tipo?: unknown;
  citaAnterior?: unknown;
  citaNueva?: unknown;
  comentario?: unknown;
};

/** Convierte lo que devolvió el modelo en CambioVersion[]: descarta (y cuenta) cualquier elemento con un tipo
 * fuera del enum, y verifica las citas contra el texto de cada versión. Una cita no verificada NO se oculta:
 * queda con valida=false para que la pantalla lo diga. */
export function validarCambios(
  crudos: unknown,
  textoAnterior: string,
  textoNuevo: string
): { cambios: CambioVersion[]; descartados: number } {
  const lista = Array.isArray(crudos) ? (crudos as CambioCrudo[]) : [];
  const cambios: CambioVersion[] = [];
  let descartados = 0;
  for (const c of lista) {
    if (!c || typeof c !== "object" || !TIPOS_CAMBIO_VERSION.includes(c.tipo as TipoCambioVersion)) {
      descartados++;
      continue;
    }
    cambios.push({
      tipo: c.tipo as TipoCambioVersion,
      citaAnterior: verificarCita(c.citaAnterior, textoAnterior),
      citaNueva: verificarCita(c.citaNueva, textoNuevo),
      comentario: typeof c.comentario === "string" ? c.comentario : "",
    });
  }
  return { cambios, descartados };
}

export type ParejaCruda = {
  explicacionNuevaId?: unknown;
  explicacionAnteriorId?: unknown;
  razon?: unknown;
};

export type ParejaValidada = {
  explicacionNuevaId: string;
  explicacionAnteriorId: string | null;
  razon: string;
};

/** Valida el emparejamiento: cada explicación nueva aparece exactamente una vez; el id anterior debe existir en
 * la versión anterior y no puede usarse dos veces (si se repite, la segunda queda "sin pareja" en vez de
 * adivinar). Toda explicación nueva que el modelo olvidó queda sin pareja. Nada se inventa en silencio. */
export function validarParejas(
  crudas: unknown,
  anteriores: Explicacion[],
  nuevas: Explicacion[]
): ParejaValidada[] {
  const lista = Array.isArray(crudas) ? (crudas as ParejaCruda[]) : [];
  const idsAnteriores = new Set(anteriores.map((e) => e.id));
  const idsNuevas = new Set(nuevas.map((e) => e.id));
  const usadasAnteriores = new Set<string>();
  const porNueva = new Map<string, ParejaValidada>();

  for (const p of lista) {
    if (!p || typeof p !== "object") continue;
    const nuevaId = typeof p.explicacionNuevaId === "string" ? p.explicacionNuevaId : "";
    if (!idsNuevas.has(nuevaId) || porNueva.has(nuevaId)) continue;
    const razon = typeof p.razon === "string" ? p.razon : "";
    const anteriorId = typeof p.explicacionAnteriorId === "string" ? p.explicacionAnteriorId : null;

    if (anteriorId === null || anteriorId === "") {
      porNueva.set(nuevaId, { explicacionNuevaId: nuevaId, explicacionAnteriorId: null, razon });
    } else if (!idsAnteriores.has(anteriorId)) {
      porNueva.set(nuevaId, {
        explicacionNuevaId: nuevaId,
        explicacionAnteriorId: null,
        razon: `El modelo propuso una pareja que no existe (${anteriorId}); queda sin pareja. ${razon}`.trim(),
      });
    } else if (usadasAnteriores.has(anteriorId)) {
      porNueva.set(nuevaId, {
        explicacionNuevaId: nuevaId,
        explicacionAnteriorId: null,
        razon: `La pareja propuesta (${anteriorId}) ya estaba asignada a otra explicación; queda sin pareja. ${razon}`.trim(),
      });
    } else {
      usadasAnteriores.add(anteriorId);
      porNueva.set(nuevaId, { explicacionNuevaId: nuevaId, explicacionAnteriorId: anteriorId, razon });
    }
  }

  return nuevas.map(
    (e) =>
      porNueva.get(e.id) ?? {
        explicacionNuevaId: e.id,
        explicacionAnteriorId: null,
        razon: "El modelo no devolvió pareja para esta explicación.",
      }
  );
}

/** Calcula, EN CÓDIGO, qué etiqueta lleva cada explicación nueva. Si el problema cambió, ninguna pareja se
 * puede comparar explicación por explicación ("no_comparable"): se muestran los resultados lado a lado y
 * nada más. "avance" es solo Frágil -> Firme con el mismo problema. */
export function calcularTransiciones(
  parejas: ParejaValidada[],
  veredictosAnteriores: Veredicto[],
  veredictosNuevos: Veredicto[],
  cambioElProblema: boolean
): TransicionExplicacion[] {
  const vAnterior = new Map(veredictosAnteriores.map((v) => [v.explicacionId, v.veredicto]));
  const vNuevo = new Map(veredictosNuevos.map((v) => [v.explicacionId, v.veredicto]));

  return parejas.map((p) => {
    const veredictoNuevo = vNuevo.get(p.explicacionNuevaId) ?? null;
    if (p.explicacionAnteriorId === null) {
      return {
        explicacionNuevaId: p.explicacionNuevaId,
        explicacionAnteriorId: null,
        veredictoAnterior: null,
        veredictoNuevo,
        etiqueta: "sin_pareja",
        razonPareja: p.razon,
      };
    }
    const veredictoAnterior = vAnterior.get(p.explicacionAnteriorId) ?? null;
    let etiqueta: TransicionExplicacion["etiqueta"];
    if (cambioElProblema) etiqueta = "no_comparable";
    else if (veredictoAnterior === veredictoNuevo) etiqueta = "sin_cambio";
    else if (veredictoAnterior === "FacilDeVariar" && veredictoNuevo === "DificilDeVariar") etiqueta = "avance";
    else etiqueta = "cambio";
    return {
      explicacionNuevaId: p.explicacionNuevaId,
      explicacionAnteriorId: p.explicacionAnteriorId,
      veredictoAnterior,
      veredictoNuevo,
      etiqueta,
      razonPareja: p.razon,
    };
  });
}
