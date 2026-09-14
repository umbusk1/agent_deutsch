import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { findUser } from "@/lib/users";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const UNAUTHORIZED = new NextResponse("Autenticación requerida.", {
  status: 401,
  headers: { "WWW-Authenticate": 'Basic realm="Agente Deutsch"' },
});

const MAINTENANCE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>En construcción</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #0f172a; color: #e2e8f0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    text-align: center; padding: 1.5rem;
  }
  .card { max-width: 28rem; }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p { margin: 0; color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <h1>En construcción</h1>
    <p>Vuelve pronto.</p>
  </div>
</body>
</html>`;

const MAINTENANCE_RESPONSE = new NextResponse(MAINTENANCE_HTML, {
  status: 503,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "retry-after": "3600",
  },
});

export function proxy(request: NextRequest) {
  if (process.env.MAINTENANCE_MODE === "true") {
    return MAINTENANCE_RESPONSE;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = authHeader.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
    const suppliedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

    let user;
    try {
      user = findUser(username);
    } catch {
      return new NextResponse("APP_USERS no está configurada o es inválida en el servidor.", {
        status: 500,
      });
    }

    if (user && safeCompare(suppliedPassword, user.password)) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-au-user", user.username);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
  }

  return UNAUTHORIZED;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
