import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { bearer, verifyJwt } from "./jwt.js";

const SECRET = "s".repeat(40);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (claims: object, secret = SECRET, header: object = { alg: "HS256", typ: "JWT" }) => {
  const h = b64(header), p = b64(claims);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const NOW = 1_800_000_000;
const ok = { sub: "ana", role: "dispatch", iat: NOW - 10, exp: NOW + 600 };

test("a token signed with the secret and not expired verifies", () => {
  assert.deepEqual(verifyJwt(mint(ok), SECRET, NOW), { sub: "ana", role: "dispatch", exp: NOW + 600 });
});

test("wrong secret, expired, missing exp, tampered payload and alg none are all refused", () => {
  assert.equal(verifyJwt(mint(ok, "x".repeat(40)), SECRET, NOW), null);
  assert.equal(verifyJwt(mint({ ...ok, exp: NOW - 1 }), SECRET, NOW), null);
  assert.equal(verifyJwt(mint({ sub: "a", role: "admin" }), SECRET, NOW), null);
  const [h, , s] = mint(ok).split(".");
  assert.equal(verifyJwt(`${h}.${b64({ ...ok, role: "admin" })}.${s}`, SECRET, NOW), null);
  assert.equal(verifyJwt(mint(ok, SECRET, { alg: "none" }), SECRET, NOW), null);
  assert.equal(verifyJwt(`${b64({ alg: "none" })}.${b64(ok)}.`, SECRET, NOW), null);
});

test("garbage and a short server secret never verify", () => {
  assert.equal(verifyJwt(undefined, SECRET), null);
  assert.equal(verifyJwt("a.b.c", SECRET), null);
  assert.equal(verifyJwt(mint(ok, "short"), "short", NOW), null);
});

test("bearer strips the scheme", () => {
  assert.equal(bearer("Bearer abc"), "abc");
  assert.equal(bearer(undefined), undefined);
});
