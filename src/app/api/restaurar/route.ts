import { findUser } from "@/lib/users";
import { restoreUsage, markRestoreTokenUsed } from "@/lib/usage";
import { verifyRestoreToken, restoreTokenId } from "@/lib/restoreLink";
import { sendEmail } from "@/lib/resend";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlResponse(titulo: string, mensaje: string, status: number): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #1e293b; }
  h1 { font-size: 1.3rem; }
</style>
</head>
<body>
  <h1>${titulo}</h1>
  <p>${mensaje}</p>
</body>
</html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const u = url.searchParams.get("u") ?? "";
  const w = url.searchParams.get("w") ?? "";
  const n = url.searchParams.get("n") ?? "";
  const sig = url.searchParams.get("sig") ?? "";

  if (!u || !w || !n || !sig || !verifyRestoreToken({ u, w, n, sig })) {
    return htmlResponse("Enlace inválido", "Este enlace de restauración no es válido o fue alterado.", 400);
  }

  const user = findUser(u);
  if (!user) {
    return htmlResponse("Usuario no encontrado", `No existe el usuario "${escapeHtml(u)}".`, 404);
  }

  try {
    const esPrimeraVez = await markRestoreTokenUsed(restoreTokenId({ u, w, n }));
    if (!esPrimeraVez) {
      return htmlResponse("Enlace ya usado", "Este enlace de restauración ya fue utilizado antes.", 200);
    }

    const nuevoConteo = await restoreUsage(u, w);

    let avisoCorreo = "";
    if (user.email) {
      try {
        await sendEmail({
          to: user.email,
          subject: "Se restauró tu cupo — Agente Deutsch",
          html: `<p>Hola${user.fullName ? " " + escapeHtml(user.fullName) : ""},</p><p>Tu apelación fue aceptada: se te restauró 1 uso del Agente Deutsch para la semana del ${escapeHtml(w)}.</p>`,
        });
      } catch (emailError) {
        console.error("No se pudo notificar al usuario de la restauración:", emailError);
        avisoCorreo = " (No se pudo enviar el correo de aviso al usuario.)";
      }
    } else {
      avisoCorreo = " (No se le notificó por correo: no hay email configurado para este usuario.)";
    }

    return htmlResponse(
      "Cupo restaurado",
      `Se restauró 1 uso para <strong>${escapeHtml(user.fullName ?? user.username)}</strong> en la semana del ${escapeHtml(w)}. Conteo actual: ${nuevoConteo}.${avisoCorreo}`,
      200
    );
  } catch (error) {
    console.error(error);
    return htmlResponse(
      "Error",
      error instanceof Error ? escapeHtml(error.message) : "Error desconocido al restaurar el cupo.",
      500
    );
  }
}
