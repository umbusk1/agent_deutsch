import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step7PrincipalPrompt, step7PersuasionPrompt, step7EnsamblajePrompt } from "@/lib/prompts";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Problema, Veredicto, ProblemaNuevo, Relacion, PasajePersuasivo, Alcance } from "@/lib/types";

// 300s (subido de 210, 2026-09-30 — auditoría de peor caso, comentario anterior desactualizado: decía
// "ronda los 200s" y no contaba el reintento de la fase 2 ni el de la fase 3b). Peor caso teórico real:
// fase 1 (2 llamadas en paralelo, cada una con su propio reintento por marcador mal formado) 2×50s=100s +
// fase 2 (reintento por parte vacía de cualquiera de las dos, en paralelo, cada una con su propio reintento
// por marcador) 2×50s=100s + fase 3a (ensamblaje) 2×50s=100s + fase 3b (reintento del ensamblaje si vino
// vacío) 2×50s=100s = 400s en total, con las cuatro fases secuenciales entre sí.
// BRECHA CONOCIDA: 400s de peor caso teórico supera los 300s documentados en el plan Hobby con Fluid
// Compute — fijamos el techo en 300s (el máximo posible) en vez de en el peor caso real, así que en el
// escenario extremo (3-4 llamadas fallando con marcador mal formado en su primer intento, nunca visto en
// producción) la función se cortaría antes de terminar. No se tocó la lógica de reintentos para cerrar esta
// brecha — decisión explícita, pendiente de revisar si alguna vez se observa en la práctica.
export const maxDuration = 300;

export async function POST(request: Request) {
  const {
    texto,
    explicaciones,
    problemas,
    veredictos,
    problemasNuevos,
    relaciones,
    pasajesPersuasivos,
    alcances,
    pasajesDescartados,
  } = (await request.json()) as {
    texto: string;
    explicaciones: Explicacion[];
    problemas: Problema[];
    veredictos: Veredicto[];
    problemasNuevos: ProblemaNuevo[];
    relaciones: Relacion[];
    pasajesPersuasivos: PasajePersuasivo[];
    alcances: Alcance[];
    // Pasajes que step1b no pudo clasificar con confianza (desglose que no reconstruía su cita) y excluyó —
    // ver step1b/route.ts. Sin esto, si terminaron siendo 0 pasajes reales, step7PersuasionPrompt afirmaría
    // "no se encontraron pasajes" aunque en realidad algo quedó sin revisar.
    pasajesDescartados?: number;
  };

  if (!texto) {
    return NextResponse.json({ error: "Falta el texto original." }, { status: 400 });
  }
  if (!explicaciones?.length) {
    return NextResponse.json({ error: "No hay explicaciones activas." }, { status: 400 });
  }

  // Streaming (Server-Sent Events) en vez de una sola respuesta al final: si el navegador no recibe
  // ningún byte mientras esperamos a Claude, algún intermediario entre el cliente y Vercel corta la
  // conexión por inactividad aunque la función termine bien (ERR_CONNECTION_CLOSED con 200 en los logs).
  // El heartbeat cada 10s mantiene la conexión viva durante las llamadas largas.
  return crearRespuestaSse(request, "step7", async (enviar) => {
    const problemasNuevosPorExplicacion = new Map<
      string,
      { enunciado: string; reconocidoPorAutor: string }[]
    >();
    for (const pn of problemasNuevos ?? []) {
      const lista = problemasNuevosPorExplicacion.get(pn.explicacionId) ?? [];
      lista.push({ enunciado: pn.enunciado, reconocidoPorAutor: pn.reconocidoPorAutor });
      problemasNuevosPorExplicacion.set(pn.explicacionId, lista);
    }

    // Mixto entra acá también (no solo AntiRacional): el pasaje sostiene algo real en parte, pero al menos una
    // oración sigue sin sostenerse por mérito propio — sigue siendo un hallazgo de persuasión legítimo, solo
    // que step7PersuasionPrompt lo trata con matiz en vez de como si todo el pasaje cerrara el argumento.
    const pasajesConPresion = (pasajesPersuasivos ?? []).filter(
      (p) => p.mecanismo === "AntiRacional" || p.mecanismo === "Mixto"
    );

    const principalPrompt = step7PrincipalPrompt(
      texto,
      explicaciones,
      problemas,
      veredictos,
      problemasNuevosPorExplicacion,
      relaciones ?? [],
      alcances ?? []
    );
    const persuasionPrompt = step7PersuasionPrompt(pasajesConPresion, pasajesDescartados ?? 0);

    let [principalResult, persuasionResult] = await Promise.all([
      callTool<{ seccionPrincipal: string }>({ ...principalPrompt, effort: "medium" }),
      callTool<{ seccionPersuasion: string }>({ ...persuasionPrompt, effort: "medium" }),
    ]);

    // Reintento puntual, una sola vez, SOLO de la llamada cuya parte obligatoria vino vacía — no de las
    // tres llamadas completas, y en paralelo entre sí si ambas lo necesitan (mismo motivo que el
    // Promise.all original: no hacer secuencial lo que puede ir junto). Caso real que motivó esto (Redis,
    // análisis "Liberalmente", 2026-09-22): el modelo completó resumenInicial y devolvió seccionPrincipal
    // vacío, sin ningún error. Antes esto se descartaba en silencio del reporte final (solo quedaba un
    // log); ahora se reintenta, y si sigue vacía tras el reintento, conAviso (más abajo) deja un aviso
    // visible en el reporte en vez de un hueco silencioso.
    async function reintentarSiVacia<K extends string>(
      resultado: Record<K, string>,
      campo: K,
      llamar: () => Promise<Record<K, string>>
    ): Promise<Record<K, string> | null> {
      if (resultado[campo]?.trim()) return null;
      console.error(`[step7] "${campo}" vino vacía, reintentando esa llamada una vez...`);
      return llamar();
    }

    const [principalReintento, persuasionReintento] = await Promise.all([
      reintentarSiVacia(principalResult, "seccionPrincipal", () =>
        callTool<{ seccionPrincipal: string }>({ ...principalPrompt, effort: "medium" })
      ),
      reintentarSiVacia(persuasionResult, "seccionPersuasion", () =>
        callTool<{ seccionPersuasion: string }>({ ...persuasionPrompt, effort: "medium" })
      ),
    ]);
    if (principalReintento) principalResult = principalReintento;
    if (persuasionReintento) persuasionResult = persuasionReintento;

    // resumenInicial vive acá, no en principalPrompt: depende solo del texto crudo, nunca de los datos
    // estructurados (explicaciones/veredictos/etc.), así que es un trabajo independiente de seccionPrincipal.
    const ensamblajePrompt = step7EnsamblajePrompt(
      texto,
      principalResult.seccionPrincipal,
      persuasionResult.seccionPersuasion
    );
    let ensamblajeResult = await callTool<{
      resumenInicial: string;
      introduccion: string;
      transicion: string;
      cierre: string;
    }>({ ...ensamblajePrompt, effort: "medium" });

    // resumenInicial/introduccion/cierre salen de la misma llamada — no se puede reintentar un campo
    // suelto de ella, así que si alguno de los tres vino vacío se reintenta la llamada entera una vez
    // (transicion queda afuera de este chequeo: es opcional por diseño, el propio prompt permite dejarla
    // en blanco si las secciones ya fluyen bien solas).
    if (![ensamblajeResult.resumenInicial, ensamblajeResult.introduccion, ensamblajeResult.cierre].every((v) => v?.trim())) {
      console.error("[step7] resumenInicial/introduccion/cierre vino vacío, reintentando el ensamblaje una vez...");
      ensamblajeResult = await callTool<{
        resumenInicial: string;
        introduccion: string;
        transicion: string;
        cierre: string;
      }>({ ...ensamblajePrompt, effort: "medium" });
    }

    // Si después del reintento la parte SIGUE vacía, no se descarta en silencio: se deja un aviso visible
    // en el propio reporte, además del log — un hueco sin explicación es peor que un aviso honesto.
    function conAviso(valor: string, nombre: string): string {
      if (valor?.trim()) return valor;
      console.error(`[step7] "${nombre}" sigue vacía después del reintento — se deja un aviso visible en el reporte.`);
      return "*Esta sección del reporte no se pudo generar correctamente en esta corrida — si te parece que falta algo importante, vuelve a generar el análisis.*";
    }

    const reporte = [
      conAviso(ensamblajeResult.resumenInicial, "resumenInicial"),
      conAviso(ensamblajeResult.introduccion, "introduccion"),
      conAviso(principalResult.seccionPrincipal, "seccionPrincipal"),
      ensamblajeResult.transicion?.trim() || null,
      conAviso(persuasionResult.seccionPersuasion, "seccionPersuasion"),
      conAviso(ensamblajeResult.cierre, "cierre"),
    ]
      .filter((parte): parte is string => Boolean(parte?.trim()))
      .join("\n\n");

    enviar({ reporte });
  });
}
