import { NextResponse } from "next/server";
import { eliminarAnalisis, obtenerAnalisis } from "@/lib/analisis";
import { findUser } from "@/lib/users";

export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const registro = await obtenerAnalisis(id);
    if (!registro) {
      return NextResponse.json({ error: "Análisis no encontrado." }, { status: 404 });
    }
    return NextResponse.json(registro);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al leer el análisis." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Solo un admin puede eliminar análisis." }, { status: 403 });
    }

    const { id } = await params;
    await eliminarAnalisis(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al eliminar el análisis." },
      { status: 500 }
    );
  }
}
