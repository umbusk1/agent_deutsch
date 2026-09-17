import { NextResponse } from "next/server";
import { findUser } from "@/lib/users";
import { peekUsage, COMPARACION_LIMIT_SEMANAL } from "@/lib/usage";

export async function GET(request: Request) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    if (!rawUsername) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }
    const username = decodeURIComponent(rawUsername);

    const user = findUser(username);
    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    }

    const isAdmin = user.role === "admin";
    const identidad = { username: user.username, fullName: user.fullName, isAdmin };

    const { searchParams } = new URL(request.url);
    const tipo = searchParams.get("tipo") === "comparacion" ? "comparacion" : "analisis";

    if (tipo === "comparacion") {
      // Cupo de comparaciones: constante fija, y los admin no lo consumen (comparaciones ilimitadas) —
      // no tiene relación con el limit/unlimited configurado por usuario para análisis.
      if (isAdmin) {
        return NextResponse.json({ ...identidad, unlimited: true });
      }
      const used = await peekUsage(user.username, undefined, "comparacion");
      return NextResponse.json({
        ...identidad,
        unlimited: false,
        limit: COMPARACION_LIMIT_SEMANAL,
        used,
        remaining: Math.max(0, COMPARACION_LIMIT_SEMANAL - used),
      });
    }

    if (user.unlimited || !user.limit) {
      return NextResponse.json({ ...identidad, unlimited: true });
    }

    const used = await peekUsage(user.username);
    return NextResponse.json({
      ...identidad,
      unlimited: false,
      limit: user.limit,
      used,
      remaining: Math.max(0, user.limit - used),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { unlimited: true, warning: "No se pudo consultar la cuota, se asume sin restricción." }
    );
  }
}
