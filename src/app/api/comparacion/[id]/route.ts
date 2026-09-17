import { NextResponse } from "next/server";
import { obtenerComparacion } from "@/lib/comparaciones";

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
