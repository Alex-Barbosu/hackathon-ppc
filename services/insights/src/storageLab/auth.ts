import { createHmac } from "node:crypto";

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/**
 * Same claims as zone A's JwtService (sub, role, iat, exp; HS256). Minted per request with a
 * 5 minute life so a leaked log line is worthless; the token itself is never logged.
 */
export function mintAdminToken(secret: string, ttlSeconds = 300, sub = "storage-lab"): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ sub, role: "admin", iat: now, exp: now + ttlSeconds }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
