import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

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

export function proxy(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return new NextResponse("APP_PASSWORD no está configurada en el servidor.", { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = authHeader.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    const suppliedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";
    if (safeCompare(suppliedPassword, appPassword)) {
      return NextResponse.next();
    }
  }

  return UNAUTHORIZED;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
