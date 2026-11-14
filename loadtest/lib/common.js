// Zone B. Shared helpers for the k6 scenarios. k6 runs inside the gateway's network
// namespace (see infra/compose.yml, services k6 and k6-slowlane), so it reaches FileGrid
// exactly like a browser: https://localhost through Caddy, TLS and auth included.
import http from "k6/http";
import crypto from "k6/crypto";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

// Uploads resent after the gateway answered 502/503 or the connection broke: what a real
// client (the web app's uploader) does when the replica serving it goes away mid-request.
// Counted separately, so a retried upload is visible and not hidden as a success.
const uploadRetries = new Counter("upload_retries");
const RETRYABLE = new Set([0, 502, 503]);

export const BASE = __ENV.BASE_URL || "https://localhost";
/** chaos-control, reached directly when the client path itself is being degraded. */
export const CHAOS = __ENV.CHAOS_URL || BASE;
// Distinguishes runs, so a rerun never uploads byte-identical files.
const RUN = Date.now();

/** Logs in as a demo user (the username decides the role) and returns auth headers. */
export function login(username) {
  const password = __ENV.DEMO_PASSWORD;
  if (!password) fail("DEMO_PASSWORD is not set (make b-load passes it from .env)");
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ username, password }), {
    headers: { "content-type": "application/json" },
    tags: { name: "login" },
  });
  if (!check(res, { "login 200": (r) => r.status === 200 })) fail(`login as ${username}: HTTP ${res.status}`);
  return { authorization: `Bearer ${res.json("token")}` };
}

// One random pool per VU, grown to the largest size asked for. Files are slices of it with
// the salt stamped in front: unique content and SHA-256 per file, without regenerating
// megabytes of randomness for every upload.
let pool = new Uint8Array(0);
export function payload(bytes, salt) {
  if (pool.length < bytes) pool = new Uint8Array(crypto.randomBytes(bytes));
  const buf = pool.slice(0, bytes);
  const stamp = `${RUN}:${salt}:`;
  for (let i = 0; i < stamp.length && i < buf.length; i++) buf[i] = stamp.charCodeAt(i);
  return buf.buffer;
}

export const REGIONS = ["muntenia", "banat", "dobrogea"];

/** Multipart upload through POST /api/v1/files; returns the receipt or undefined. */
export function upload(headers, category, bytes, salt, extraTags = {}) {
  const body = payload(bytes, salt);
  const form = {
    category,
    region: REGIONS[salt % REGIONS.length],
    description: `k6 ${category}`,
    file: http.file(body, `k6-${category}-${salt}.bin`, "application/octet-stream"),
  };
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      uploadRetries.add(1, { category });
      sleep(0.5 * attempt);
    }
    res = http.post(`${BASE}/api/v1/files`, form, { headers, tags: { name: "upload", category, ...extraTags }, timeout: "120s" });
    // Only gateway and connection failures are retried: there the API never acknowledged
    // the file. A 4xx or a 201 is final.
    if (!RETRYABLE.has(res.status)) break;
  }
  const ok = check(res, { [`${category} upload 201`]: (r) => r.status === 201 });
  if (!ok) return undefined;
  const receipt = res.json();
  check(receipt, { [`${category} receipt sha256 matches`]: (r) => r.sha256 === crypto.sha256(body, "hex") });
  return receipt;
}

/** Downloads a file and checks the bytes hash to the receipt's SHA-256 (gating requirement 4). */
export function downloadAndVerify(headers, receipt, category) {
  const res = http.get(`${BASE}/api/v1/files/${receipt.id}/content`, {
    headers,
    responseType: "binary",
    tags: { name: "download", category },
    timeout: "120s",
  });
  check(res, {
    [`${category} download 200`]: (r) => r.status === 200,
    [`${category} download byte-identical`]: (r) => r.status === 200 && crypto.sha256(r.body, "hex") === receipt.sha256,
  });
}

/** k6 thresholds and summary trend stats shared by every scenario. */
export const summaryTrendStats = ["avg", "p(50)", "p(95)", "p(99)", "max"];
