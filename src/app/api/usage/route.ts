import { NextResponse } from "next/server";
import { findUser } from "@/lib/users";
import { peekUsage } from "@/lib/usage";

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

    if (user.unlimited || !user.limit) {
      return NextResponse.json({ username: user.username, unlimited: true });
    }

    const used = await peekUsage(user.username);
    return NextResponse.json({
      username: user.username,
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
