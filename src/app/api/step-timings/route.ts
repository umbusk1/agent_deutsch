import { NextResponse } from "next/server";
import { listarDuraciones } from "@/lib/step-timings";
import { findUser } from "@/lib/users";

export const maxDuration = 15;

// Solo lectura, solo admin — mismo patrón de autorización que DELETE /api/analisis/[id]. Existe para poder
// leer el registro de duraciones (ver step-timings.ts) desde afuera sin acceso directo a Redis: ni el
// sandbox de desarrollo ni un vistazo rápido a los logs de Vercel (que expiran a la hora en el plan Hobby)
// alcanzan para esto.
export async function GET(request: Request) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Solo un admin puede leer este registro." }, { status: 403 });
    }

    const duraciones = await listarDuraciones();
    return NextResponse.json({ duraciones });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al leer el registro de duraciones." },
      { status: 500 }
    );
  }
}
