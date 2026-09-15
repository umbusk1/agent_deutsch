import { createHmac, randomBytes, timingSafeEqual } from "crypto";

function getSecret(): string {
  const secret = process.env.RESTORE_LINK_SECRET;
  if (!secret) {
    throw new Error("RESTORE_LINK_SECRET no está configurada en el servidor.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

type TokenParts = { u: string; w: string; n: string };

function payloadOf({ u, w, n }: TokenParts): string {
  return `${u}:${w}:${n}`;
}

/** Construye el enlace de restauración firmado (usuario + semana exacta + nonce único por apelación). */
export function createRestoreLink(origin: string, username: string, weekId: string): string {
  const nonce = randomBytes(9).toString("base64url");
  const sig = sign(payloadOf({ u: username, w: weekId, n: nonce }));

  const url = new URL("/api/restaurar", origin);
  url.searchParams.set("u", username);
  url.searchParams.set("w", weekId);
  url.searchParams.set("n", nonce);
  url.searchParams.set("sig", sig);
  return url.toString();
}

export function verifyRestoreToken(params: TokenParts & { sig: string }): boolean {
  const expected = Buffer.from(sign(payloadOf(params)));
  const provided = Buffer.from(params.sig);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Identificador estable del token, para marcarlo como usado (no adivinable sin la firma válida). */
export function restoreTokenId(params: TokenParts): string {
  return payloadOf(params);
}
