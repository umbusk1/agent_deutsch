import { NextResponse } from "next/server";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesionPasaje, guardarMejoraSesionPasaje } from "@/lib/mejora";
import { findUser } from "@/lib/users";

export const maxDuration = 15;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; pasajeId: string }> }
) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }

    const { id: analisisId, pasajeId } = await params;

    // Mejora está restringida al autor del análisis, SIN excepción para admin — esta ruta no lo chequeaba
    // en absoluto (ni siquiera pedía el análisis) antes de este fix.
    const analisis = await obtenerAnalisis(analisisId);
    if (!analisis) {
      return NextResponse.json({ error: "Análisis no encontrado." }, { status: 404 });
    }
    if (analisis.usuario !== user.username) {
      return NextResponse.json(
        { error: "Mejora está restringido al autor de este análisis." },
        { status: 403 }
      );
    }

    const { intentoId } = (await request.json()) as { intentoId: string };
    if (!intentoId) {
      return NextResponse.json({ error: "Falta el intento a aplicar." }, { status: 400 });
    }

    const sesion = await obtenerMejoraSesionPasaje(analisisId, pasajeId);
    if (!sesion) {
      return NextResponse.json({ error: "No hay ninguna sesión de Mejora para este pasaje todavía." }, { status: 404 });
    }
    if (!sesion.intentos.some((i) => i.id === intentoId)) {
      return NextResponse.json({ error: "Ese intento no existe en esta sesión." }, { status: 400 });
    }

    const actualizada = { ...sesion, aplicadoIntentoId: intentoId, actualizadoEn: new Date().toISOString() };
    await guardarMejoraSesionPasaje(actualizada);

    return NextResponse.json({ sesion: actualizada });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al aplicar el cambio." },
      { status: 500 }
    );
  }
}
