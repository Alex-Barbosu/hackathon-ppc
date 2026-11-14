import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiClient } from "./client.js";
import { asLabError, codeFromResponse, LabError, recordError } from "./errors.js";
import type { Cell } from "./types.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const stubFetch = (res: () => Response | Promise<Response>) => { globalThis.fetch = (async () => res()) as typeof fetch; };
const emptyCell = (): Cell => ({ category: "video", storage: "db", status: "running", samples: 3, completed: 0, sizeBytes: 1, method: "multipart", errors: 0, errorSamples: [], integrityOk: null });

test("a 413 whose message names a file stores exactly upload:TOO_LARGE", async () => {
  const body = { code: "TOO_LARGE", message: "cannot store passport-ion-popescu.pdf (104857600 bytes)", traceId: "abc" };
  stubFetch(() => new Response(JSON.stringify(body), { status: 413 }));
  const err = await new ApiClient("http://api", "x".repeat(32)).uploadForced("video", "db", 1024).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof LabError);
  assert.equal(err.code, "upload:TOO_LARGE");
  assert.equal(err.message, "upload:TOO_LARGE");
  const cell = emptyCell();
  recordError(cell, err.code);
  assert.deepEqual(cell.errorSamples, ["upload:TOO_LARGE"]);
  assert.ok(!JSON.stringify(cell).includes("popescu"));
});

test("a body without a usable code falls back to the HTTP status, never to text", () => {
  assert.equal(codeFromResponse("upload", 502, "<html>Bad gateway for secret.pdf</html>"), "upload:HTTP_502");
  assert.equal(codeFromResponse("upload", 500, ""), "upload:HTTP_500");
  assert.equal(codeFromResponse("upload", 400, JSON.stringify({ code: "secret-name.pdf" })), "upload:HTTP_400");
});

test("a server-reported integrity failure on download is download:INTEGRITY_FAILED", async () => {
  stubFetch(() => new Response(JSON.stringify({ code: "INTEGRITY_FAILED", message: "x" }), { status: 422 }));
  const err = await new ApiClient("http://api", "x".repeat(32)).downloadHash("id").then(() => null, (e: unknown) => e);
  assert.ok(err instanceof LabError);
  assert.equal(err.code, "download:INTEGRITY_FAILED");
});

test("network failures become <phase>:NETWORK without the error text", () => {
  assert.equal(asLabError(new TypeError("fetch failed: ECONNRESET api:8080"), "download").code, "download:NETWORK");
  assert.equal(asLabError(new LabError("upload:TOO_LARGE"), "download").code, "upload:TOO_LARGE");
});

test("errorSamples are de-duplicated and capped at five while errors counts every failure", () => {
  const cell = emptyCell();
  for (let i = 0; i < 4; i++) recordError(cell, "upload:TOO_LARGE");
  for (const c of ["a", "b", "c", "d", "e", "f"]) recordError(cell, `upload:${c}`);
  assert.equal(cell.errors, 10);
  assert.equal(cell.errorSamples.length, 5);
  assert.equal(new Set(cell.errorSamples).size, 5);
});
