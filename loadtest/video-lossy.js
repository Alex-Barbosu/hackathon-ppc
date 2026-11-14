// Zone B. A drone inspection video uploaded from a field van over a bad link: resumable
// tus upload through the slow lane (https://localhost:8443 → Toxiproxy → Caddy) while
// chaos-control makes the link slow and lossy. Every reset connection is resumed from the
// server's offset (HEAD), never restarted, and the downloaded file must hash to the SHA-256
// of what was sent. Proves NFR resilience: transfers on lossy links finish without manual
// action, with flat server memory (video is streamed to S3 in parts).
//   make b-load S=video-lossy [VIDEO_MB=128] [LOSS_PCT=20] [LATENCY_MS=150] [BANDWIDTH_KBPS=50000]
import http from "k6/http";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";
import { BASE, CHAOS, login, summaryTrendStats } from "./lib/common.js";

const MB = 1024 * 1024;
const VIDEO_BYTES = Number(__ENV.VIDEO_MB || 128) * MB;
// Smaller than the server's 16 MB S3 part on purpose: a reset costs at most one chunk.
const CHUNK = Number(__ENV.CHUNK_MB || 8) * MB;
const MAX_RESUMES = Number(__ENV.MAX_RESUMES || 200);
const LINK = {
  target: "client",
  latencyMs: Number(__ENV.LATENCY_MS || 150),
  jitterMs: Number(__ENV.JITTER_MS || 50),
  lossPct: Number(__ENV.LOSS_PCT || 20),
  bandwidthKbps: Number(__ENV.BANDWIDTH_KBPS || 50000),
};

const resumes = new Counter("video_resumes");
const chunkFailures = new Counter("video_chunk_failures");

export const options = {
  insecureSkipTLSVerify: true,
  // A field modem re-dials; and Toxiproxy's loss toxic picks connections, not requests, so
  // a fresh connection per chunk makes LOSS_PCT mean "share of chunks cut mid-transfer".
  noConnectionReuse: true,
  summaryTrendStats,
  scenarios: { video: { executor: "per-vu-iterations", vus: 1, iterations: 1, maxDuration: "30m" } },
  thresholds: {
    "checks{check:video upload completed}": ["rate==1"],
    "checks{check:video download byte-identical}": ["rate==1"],
  },
};

// The file is defined by position, not held in memory: byte i = pool[i % pool.length], with
// a per-run stamp at the front. Any range can be rebuilt exactly when a chunk is resent.
const pool = new Uint8Array(crypto.randomBytes(CHUNK));
const stamp = `k6-video-${Date.now()}:`;
function range(start, len) {
  const out = new Uint8Array(len);
  let filled = 0;
  while (filled < len) {
    const pos = (start + filled) % pool.length;
    const n = Math.min(len - filled, pool.length - pos);
    out.set(pool.subarray(pos, pos + n), filled);
    filled += n;
  }
  for (let i = start; i < stamp.length && i - start < len; i++) out[i - start] = stamp.charCodeAt(i);
  return out.buffer;
}

function sha256OfVideo() {
  const h = crypto.createHash("sha256");
  for (let off = 0; off < VIDEO_BYTES; off += CHUNK) h.update(range(off, Math.min(CHUNK, VIDEO_BYTES - off)));
  return h.digest("hex");
}

const tusHeaders = (auth, extra) => ({ ...auth, "Tus-Resumable": "1.0.0", ...extra });

function chaos(admin, condition) {
  // Retried: a heal that fails would leave the demo's slow lane broken.
  for (let i = 0; i < 5; i++) {
    const res = http.post(`${CHAOS}/chaos/network`, JSON.stringify(condition), {
      headers: { ...admin, "content-type": "application/json" },
      tags: { name: "chaos" },
    });
    if (res.status === 202) return;
    sleep(1);
  }
  fail(`chaos network ${JSON.stringify(condition)} failed`);
}

export function setup() {
  return { admin: login("admin"), field: login("field") };
}

export default function (auth) {
  const expected = sha256OfVideo();
  const meta = [
    `category ${encoding.b64encode("video")}`,
    `filename ${encoding.b64encode("k6-drone-inspection.mp4")}`,
    `region ${encoding.b64encode("dobrogea")}`,
  ].join(",");
  const created = http.post(`${BASE}/api/v1/files/tus`, null, {
    headers: tusHeaders(auth.field, { "Upload-Length": String(VIDEO_BYTES), "Upload-Metadata": meta }),
    tags: { name: "tus create" },
  });
  if (!check(created, { "tus create 201": (r) => r.status === 201 })) fail(`tus create: HTTP ${created.status} ${created.body}`);
  const url = `${BASE}${created.headers["Location"]}`;

  // The link degrades only now, so login and creation are not what is being tested.
  chaos(auth.admin, LINK);
  let offset = 0;
  let fileId = "";
  let attempts = 0;
  const started = Date.now();
  try {
    while (offset < VIDEO_BYTES && attempts <= MAX_RESUMES) {
      const len = Math.min(CHUNK, VIDEO_BYTES - offset);
      const res = http.patch(url, range(offset, len), {
        headers: tusHeaders(auth.field, { "Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset) }),
        tags: { name: "tus patch" },
        timeout: "120s",
      });
      if (res.status === 204) {
        offset = Number(res.headers["Upload-Offset"]);
        fileId = res.headers["X-Filegrid-File-Id"] || fileId;
        continue;
      }
      // Reset, timeout or conflict: ask the server where it stands and continue from there.
      chunkFailures.add(1);
      attempts++;
      sleep(Math.min(5, 0.2 * 2 ** Math.min(attempts, 5)) * Math.random());
      const head = http.request("HEAD", url, null, { headers: tusHeaders(auth.field), tags: { name: "tus head" } });
      if (head.status === 200) {
        // The server keeps every byte that arrived, so this is usually past the old offset.
        offset = Number(head.headers["Upload-Offset"]);
        resumes.add(1);
      }
    }
  } finally {
    // Always heal the link, even if the upload failed.
    chaos(auth.admin, { target: "client" });
  }
  const seconds = (Date.now() - started) / 1000;
  console.log(`video: ${VIDEO_BYTES / MB} MB in ${seconds.toFixed(1)} s over ${JSON.stringify(LINK)}, ${attempts} interrupted chunks resumed`);
  check(offset, { "video upload completed": (o) => o === VIDEO_BYTES });
  if (!fileId) fail("no X-FileGrid-File-Id on the final chunk");

  const dl = http.get(`${BASE}/api/v1/files/${fileId}/content`, {
    headers: auth.field,
    responseType: "binary",
    timeout: "600s",
    tags: { name: "download", category: "video" },
  });
  check(dl, {
    "video download 200": (r) => r.status === 200,
    "video download byte-identical": (r) => r.status === 200 && crypto.sha256(r.body, "hex") === expected,
  });
}
