import { NextResponse } from "next/server";
import { guardarAnalisis, listarAnalisis } from "@/lib/analisis";
import { findUser } from "@/lib/users";
import { registrarVersion, resolverVersionNueva } from "@/lib/versiones";
import type {
  Problema,
  Explicacion,
  Veredicto,
  ProblemaNuevo,
  Relacion,
  Alcance,
  PasajePersuasivo,
  IdentificacionExplicacion,
} from "@/lib/types";

export const maxDuration = 30;

export async function GET() {
  try {
    const analisis = await listarAnalisis();
    return NextResponse.json({ analisis });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al listar los análisis." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }

    const body = (await request.json()) as {
      metaFecha?: string;
      metaAutor?: string;
      metaMedio?: string;
      metaTitulo?: string;
      reporte?: string;
      tripletas?: string;
      problemas?: Problema[];
      explicaciones?: Explicacion[];
      texto?: string;
      veredictos?: Veredicto[];
      problemasNuevos?: ProblemaNuevo[];
      relaciones?: Relacion[];
      alcances?: Alcance[];
      pasajesPersuasivos?: PasajePersuasivo[];
      pasajesDescartados?: number;
      identificaciones?: IdentificacionExplicacion[];
      /** Solo cuando este análisis es una versión nueva de otro (ver /api/step1). */
      versionAnteriorId?: string;
    };

    if (!body.reporte?.trim()) {
      return NextResponse.json({ error: "Falta el reporte a guardar." }, { status: 400 });
    }
    // La Biblioteca es compartida entre los 3 usuarios: un "(sin título)" ahí confunde a los otros dos, no
    // solo a quien corrió el análisis — por eso se exige acá también, no solo deshabilitando el botón en la UI.
    if (!body.metaTitulo?.trim()) {
      return NextResponse.json({ error: "Falta el título del análisis." }, { status: 400 });
    }

    // Versión nueva: el servidor recalcula raíz y número (nunca se confía en lo que diga el cliente) y vuelve a
    // validar que quien guarda es el autor del análisis anterior.
    let version: { versionRaizId: string; versionNumero: number; versionAnteriorId: string } | undefined;
    if (body.versionAnteriorId) {
      const resolucion = await resolverVersionNueva(body.versionAnteriorId, user.username, user.role === "admin");
      if (!resolucion.ok) {
        return NextResponse.json({ error: resolucion.error }, { status: resolucion.status });
      }
      version = {
        versionRaizId: resolucion.raizId,
        versionNumero: resolucion.numero,
        versionAnteriorId: resolucion.anterior.id,
      };
    }

    const registro = await guardarAnalisis({
      metaFecha: body.metaFecha ?? "",
      metaAutor: body.metaAutor ?? "",
      metaMedio: body.metaMedio ?? "",
      metaTitulo: body.metaTitulo ?? "",
      usuario: user.username,
      reporte: body.reporte,
      tripletas: body.tripletas ?? "",
      problemas: body.problemas ?? [],
      explicaciones: body.explicaciones ?? [],
      texto: body.texto,
      veredictos: body.veredictos,
      problemasNuevos: body.problemasNuevos,
      relaciones: body.relaciones,
      alcances: body.alcances,
      pasajesPersuasivos: body.pasajesPersuasivos,
      pasajesDescartados: body.pasajesDescartados,
      identificaciones: body.identificaciones,
      ...(version ?? {}),
    });

    if (version) {
      await registrarVersion(version.versionRaizId, registro.id);
    }

    return NextResponse.json({
      id: registro.id,
      ...(version ? { versionNumero: version.versionNumero } : {}),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al guardar el análisis." },
      { status: 500 }
    );
  }
}
