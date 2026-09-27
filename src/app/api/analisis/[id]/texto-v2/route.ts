import { NextResponse } from "next/server";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesiones } from "@/lib/mejora";
import { ensamblarTextoV2 } from "@/lib/textoV2";
import { findUser } from "@/lib/users";

export const maxDuration = 15;

// TextoV2 se calcula al vuelo en cada GET, a partir de texto + explicaciones + las sesiones de Mejora
// existentes — no hay ninguna copia persistida en ningún lado. Si mañana se aplica un intento nuevo, el
// siguiente GET ya lo refleja sin ningún paso de sincronización.
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
    if (!analisis.texto || !analisis.explicaciones) {
      return NextResponse.json(
        { error: "Este análisis no tiene los datos completos que TextoV2 necesita." },
        { status: 400 }
      );
    }

    const explicacionIds = analisis.explicaciones.map((e) => e.id);
    const sesiones = await obtenerMejoraSesiones(analisisId, explicacionIds);

    const resultado = ensamblarTextoV2(analisis.texto, analisis.explicaciones, sesiones);
    if (resultado.texto === null && resultado.errores.length === 0) {
      // Ensamblaje "exitoso" en el sentido de que no hubo ningún error — simplemente no hay ningún cambio
      // aplicado todavía. Ver el comentario en ensamblarTextoV2: esto es distinto de un error de ensamblaje.
      return NextResponse.json(
        { error: "Este análisis no tiene ningún cambio de Mejora aplicado todavía." },
        { status: 404 }
      );
    }

    return NextResponse.json(resultado);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al ensamblar TextoV2." },
      { status: 500 }
    );
  }
}
