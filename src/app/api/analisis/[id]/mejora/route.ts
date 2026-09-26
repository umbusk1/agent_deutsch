import { NextResponse } from "next/server";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesiones } from "@/lib/mejora";
import { estaTextoDesbloqueado, textosDesbloqueadosEstaSemana, MEJORA_TEXTOS_LIMIT_SEMANAL } from "@/lib/usage";
import { findUser } from "@/lib/users";

export const maxDuration = 30;

// Solo lectura — nunca gasta cupo. El cupo semanal de Mejora se gasta únicamente al evaluar (ver
// mejora/[explicacionId]/evaluar/route.ts), no por entrar a mirar esta lista ni por cambiar de pestaña.
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
    if (!analisis.veredictos || !analisis.explicaciones || !analisis.texto) {
      // Registros guardados antes de que se empezara a persistir la corrida completa (ver comentario en
      // AnalisisGuardado) no tienen los datos que Mejora necesita — no hay nada que ofrecer para este análisis.
      return NextResponse.json({ explicaciones: [], cupo: null });
    }

    const fragiles = analisis.veredictos.filter((v) => v.veredicto === "FacilDeVariar");
    const fragilIds = fragiles.map((v) => v.explicacionId);
    const sesiones = await obtenerMejoraSesiones(analisisId, fragilIds);

    const explicaciones = fragiles
      .map((v) => {
        const explicacion = analisis.explicaciones!.find((e) => e.id === v.explicacionId);
        if (!explicacion) return null;
        return {
          id: explicacion.id,
          cita: explicacion.cita,
          mecanismoGeneral: explicacion.mecanismoGeneral,
          razonFragil: v.justificacion,
          sesion: sesiones.get(explicacion.id) ?? null,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

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

    return NextResponse.json({ explicaciones, cupo });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al leer Mejora." },
      { status: 500 }
    );
  }
}
