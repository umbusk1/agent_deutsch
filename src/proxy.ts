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

export function proxy(request: NextRequest) {
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
