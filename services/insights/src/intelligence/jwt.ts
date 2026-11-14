import { createHmac, timingSafeEqual } from "node:crypto";

export interface Claims { sub: string; role: string; exp: number }

/**
 * Verifies a token filegrid-api issued (HS256, claims sub/role/iat/exp). Same rules as zone A's
 * JwtService: the alg must be exactly HS256, the signature is always recomputed, exp is required.
 * Endpoints that spend money or expose data cannot lean on filegrid-api to check for them.
 */
export function verifyJwt(token: string | undefined, secret: string, nowSec = Date.now() / 1000): Claims | null {
  if (!token || secret.length < 32) return null;
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  try {
    if ((JSON.parse(Buffer.from(head, "base64url").toString()) as { alg?: string }).alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as Partial<Claims>;
    if (typeof c.sub !== "string" || typeof c.role !== "string" || typeof c.exp !== "number" || c.exp <= nowSec) return null;
    return { sub: c.sub, role: c.role, exp: c.exp };
  } catch {
    return null;
  }
}

export const bearer = (header: string | undefined): string | undefined => header?.replace(/^Bearer /i, "");
