import { NextResponse } from "next/server";
import { guardarAnalisis, listarAnalisis } from "@/lib/analisis";
import { findUser } from "@/lib/users";
import type { Problema, Explicacion } from "@/lib/types";

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
    };

    if (!body.reporte?.trim()) {
      return NextResponse.json({ error: "Falta el reporte a guardar." }, { status: 400 });
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
    });

    return NextResponse.json({ id: registro.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al guardar el análisis." },
      { status: 500 }
    );
  }
}
