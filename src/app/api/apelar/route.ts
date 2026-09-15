import { NextResponse } from "next/server";
import { findUser } from "@/lib/users";
import { currentWeekId } from "@/lib/usage";
import { createRestoreLink } from "@/lib/restoreLink";
import { sendEmail } from "@/lib/resend";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "moises@umbusk.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(request: Request) {
  try {
    const { texto, justificacion } = (await request.json()) as { texto: string; justificacion: string };
    if (!texto?.trim() || !justificacion?.trim()) {
      return NextResponse.json(
        { error: "Falta el texto o la justificación de la apelación." },
        { status: 400 }
      );
    }

    const username = request.headers.get("x-au-user");
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }

    const weekId = currentWeekId();
    const origin = new URL(request.url).origin;
    const restoreLink = createRestoreLink(origin, user.username, weekId);
    const nombre = user.fullName ?? user.username;

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Apelación de rechazo — Agente Deutsch (${nombre})`,
      html: `
        <p><strong>${escapeHtml(nombre)}</strong> (usuario: ${escapeHtml(user.username)}) apela el rechazo de un análisis.</p>
        <p><strong>Justificación de la apelación:</strong><br>${escapeHtml(justificacion).replace(/\n/g, "<br>")}</p>
        <p><strong>Texto rechazado:</strong></p>
        <pre style="white-space:pre-wrap;font-family:inherit;border:1px solid #ddd;padding:0.75rem;border-radius:6px;">${escapeHtml(texto)}</pre>
        <p><a href="${restoreLink}">Restaurar 1 uso de esta semana para ${escapeHtml(user.username)}</a></p>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al enviar la apelación." },
      { status: 500 }
    );
  }
}
