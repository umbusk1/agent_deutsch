import { NextResponse } from "next/server";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesionesExplicacion, obtenerMejoraSesionesPasaje } from "@/lib/mejora";
import { estaTextoDesbloqueado, textosDesbloqueadosEstaSemana, MEJORA_TEXTOS_LIMIT_SEMANAL } from "@/lib/usage";
import { findUser } from "@/lib/users";

export const maxDuration = 30;

// Solo lectura — nunca gasta cupo. El cupo semanal de Mejora se gasta únicamente al evaluar (ver
// mejora/[explicacionId|pasaje/[pasajeId]]/evaluar/route.ts), no por entrar a mirar esta lista ni por cambiar
// de pestaña. Lista UNIFICADA: explicaciones Frágiles y pasajes que cierran el argumento se devuelven en un
// solo array `hallazgos`, cada uno etiquetado con `tipoHallazgo`, para que el selector de pestañas del cliente
// itere sobre una sola lista en vez de tener que combinar dos por su cuenta.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }

    const { id: analisisId } = await params;
    const analisis = await obtenerAnalisis(analisisId);
    if (!analisis) {
      return NextResponse.json({ error: "Análisis no encontrado." }, { status: 404 });
    }
    // Mejora está restringida al autor del análisis, SIN excepción para admin (a diferencia de
    // editar/eliminar metadata) — es una decisión de producto explícita, no un descuido: el admin puede ver
    // y editar cualquier análisis, pero poner a prueba reformulaciones de un texto ajeno no es su rol acá.
    if (analisis.usuario !== user.username) {
      return NextResponse.json(
        { error: "Mejora está restringido al autor de este análisis." },
        { status: 403 }
      );
    }
    if (!analisis.veredictos || !analisis.explicaciones || !analisis.texto) {
      // Registros guardados antes de que se empezara a persistir la corrida completa (ver comentario en
      // AnalisisGuardado) no tienen los datos que Mejora necesita — no hay nada que ofrecer para este análisis.
      return NextResponse.json({ hallazgos: [], cupo: null });
    }

    const fragiles = analisis.veredictos.filter((v) => v.veredicto === "FacilDeVariar");
    const fragilIds = fragiles.map((v) => v.explicacionId);
    const sesionesExplicacion = await obtenerMejoraSesionesExplicacion(analisisId, fragilIds);

    const hallazgosExplicacion = fragiles
      .map((v) => {
        const explicacion = analisis.explicaciones!.find((e) => e.id === v.explicacionId);
        if (!explicacion) return null;
        return {
          tipoHallazgo: "explicacion" as const,
          id: explicacion.id,
          cita: explicacion.cita,
          mecanismoGeneral: explicacion.mecanismoGeneral,
          razonFragil: v.justificacion,
          sesion: sesionesExplicacion.get(explicacion.id) ?? null,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    const cierranArgumento = (analisis.pasajesPersuasivos ?? []).filter((p) => p.mecanismo === "AntiRacional");
    const cierranArgumentoIds = cierranArgumento.map((p) => p.id);
    const sesionesPasaje = await obtenerMejoraSesionesPasaje(analisisId, cierranArgumentoIds);

    const hallazgosPasaje = cierranArgumento.map((p) => ({
      tipoHallazgo: "pasaje" as const,
      id: p.id,
      cita: p.cita,
      tecnicasOriginales: p.tecnicas,
      razonDespojo: p.justificacion,
      sesion: sesionesPasaje.get(p.id) ?? null,
    }));

    const hallazgos = [...hallazgosExplicacion, ...hallazgosPasaje];

    // Mismo patrón que /api/usage/route.ts para comparaciones: los admin ven el cupo como ilimitado, sin
    // siquiera consultar el SET (nunca lo tocan, así que consultarlo no aportaría nada distinto de "0 usados").
    const isAdmin = user.role === "admin";
    const cupo = isAdmin
      ? { desbloqueado: true, textosUsados: 0, limite: MEJORA_TEXTOS_LIMIT_SEMANAL, unlimited: true as const }
      : {
          desbloqueado: await estaTextoDesbloqueado(user.username, analisisId),
          textosUsados: await textosDesbloqueadosEstaSemana(user.username),
          limite: MEJORA_TEXTOS_LIMIT_SEMANAL,
          unlimited: false as const,
        };

    return NextResponse.json({ hallazgos, cupo });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al leer Mejora." },
      { status: 500 }
    );
  }
}
