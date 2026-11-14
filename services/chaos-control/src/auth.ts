// Every /chaos action can stop a storage or corrupt data, so only `admin` may call it.
// Tokens are the HS256 JWTs filegrid-api issues at POST /api/v1/auth/login, signed with the
// shared JWT_SECRET, with claims sub, role, iat, exp. Verification mirrors zone A's
// JwtService: alg must be exactly HS256 and the signature is always recomputed, so
// `alg: none` and algorithm-confusion tokens are rejected.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Principal {
  sub: string;
  role: string;
}

export type AuthResult = { ok: true; principal: Principal } | { ok: false; status: 401 | 403; message: string };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function sign(secret: string, input: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

function decodeJson(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function verifyJwt(token: string, secret: string, nowSec: number = Math.floor(Date.now() / 1000)): Principal | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts as [string, string, string];
  if (decodeJson(header)?.alg !== "HS256") return undefined;
  const expected = sign(secret, `${header}.${payload}`);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  const claims = decodeJson(payload);
  if (!claims) return undefined;
  const { sub, role, exp } = claims;
  if (typeof exp !== "number" || exp <= nowSec) return undefined;
  if (typeof sub !== "string" || sub === "" || typeof role !== "string") return undefined;
  return { sub, role };
}

/** Checks `Authorization: Bearer <jwt>` and requires role admin. */
export function authorizeAdmin(authorization: string | undefined, secret: string): AuthResult {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!match?.[1]) return { ok: false, status: 401, message: "Bearer token required" };
  const principal = verifyJwt(match[1], secret);
  if (!principal) return { ok: false, status: 401, message: "invalid or expired token" };
  if (principal.role !== "admin") return { ok: false, status: 403, message: "chaos actions need the admin role" };
  return { ok: true, principal };
}

/** Same token shape as zone A's login, for `make b-token` and tests. */
export function mintJwt(secret: string, sub: string, role: string, ttlSec: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ sub, role, iat: nowSec, exp: nowSec + ttlSec })));
  return `${header}.${payload}.${b64url(sign(secret, `${header}.${payload}`))}`;
}
