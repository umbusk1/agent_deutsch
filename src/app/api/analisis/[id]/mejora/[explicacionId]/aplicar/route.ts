import { NextResponse } from "next/server";
import { obtenerMejoraSesion, guardarMejoraSesion } from "@/lib/mejora";
import { findUser } from "@/lib/users";

export const maxDuration = 15;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; explicacionId: string }> }
) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }

    const { id: analisisId, explicacionId } = await params;
    const { intentoId } = (await request.json()) as { intentoId: string };
    if (!intentoId) {
      return NextResponse.json({ error: "Falta el intento a aplicar." }, { status: 400 });
    }

    const sesion = await obtenerMejoraSesion(analisisId, explicacionId);
    if (!sesion) {
      return NextResponse.json({ error: "No hay ninguna sesión de Mejora para esta explicación todavía." }, { status: 404 });
    }
    if (!sesion.intentos.some((i) => i.id === intentoId)) {
      return NextResponse.json({ error: "Ese intento no existe en esta sesión." }, { status: 400 });
    }

    const actualizada = { ...sesion, aplicadoIntentoId: intentoId, actualizadoEn: new Date().toISOString() };
    await guardarMejoraSesion(actualizada);

    return NextResponse.json({ sesion: actualizada });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al aplicar el cambio." },
      { status: 500 }
    );
  }
}
