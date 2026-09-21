import { NextResponse } from "next/server";
import { eliminarComparacion, obtenerComparacion } from "@/lib/comparaciones";
import { findUser } from "@/lib/users";

export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const registro = await obtenerComparacion(id);
    if (!registro) {
      return NextResponse.json({ error: "Comparación no encontrada." }, { status: 404 });
    }
    return NextResponse.json(registro);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al leer la comparación." },
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
      return NextResponse.json({ error: "Solo un admin puede eliminar comparaciones." }, { status: 403 });
    }

    const { id } = await params;
    await eliminarComparacion(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al eliminar la comparación." },
      { status: 500 }
    );
  }
}
