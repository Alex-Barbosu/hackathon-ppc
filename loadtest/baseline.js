// Zone B. A normal day: steady outage and document uploads, searches, and downloads that
// are checked byte for byte against their receipt. Run it alongside the meter simulator
// (normal profile) to get the reference latencies a storm is compared with.
//   make b-load S=baseline [DURATION=5m]
import http from "k6/http";
import { check } from "k6";
import { BASE, login, upload, downloadAndVerify, summaryTrendStats } from "./lib/common.js";

const DURATION = __ENV.DURATION || "3m";
// Uploads per second. Outage records are rare on a calm day; documents are moderate.
const OUTAGE_PER_SEC = Number(__ENV.OUTAGE_PER_SEC || 0.2);
const DOCUMENT_PER_SEC = Number(__ENV.DOCUMENT_PER_SEC || 0.5);

const perMinute = (perSec) => ({ rate: Math.max(1, Math.round(perSec * 60)), timeUnit: "1m" });

export const options = {
  insecureSkipTLSVerify: true, // Caddy's local CA; the browser path is covered by `make trust`.
  summaryTrendStats,
  scenarios: {
    outage: { executor: "constant-arrival-rate", ...perMinute(OUTAGE_PER_SEC), duration: DURATION, preAllocatedVUs: 4, maxVUs: 20, exec: "outage" },
    document: { executor: "constant-arrival-rate", ...perMinute(DOCUMENT_PER_SEC), duration: DURATION, preAllocatedVUs: 4, maxVUs: 20, exec: "document" },
    search: { executor: "constant-arrival-rate", rate: 60, timeUnit: "1m", duration: DURATION, preAllocatedVUs: 2, maxVUs: 10, exec: "search" },
  },
  thresholds: {
    "http_req_failed": ["rate<0.01"],
    "checks": ["rate>0.99"],
    "http_req_duration{name:upload,category:outage}": ["p(95)<2000"],
    "http_req_duration{name:upload,category:document}": ["p(95)<3000"],
  },
};

export function setup() {
  // Each category is uploaded by the role that owns it in the brief.
  return { dispatch: login("dispatch"), connections: login("connections") };
}

// Outage records: 1-10 MB in the brief.
export function outage(auth) {
  const mb = 1 + Math.floor(Math.random() * 10);
  const r = upload(auth.dispatch, "outage", mb * 1024 * 1024, __VU * 100000 + __ITER);
  if (r) downloadAndVerify(auth.dispatch, r, "outage");
}

// Customer documents: 0.1-10 MB, encrypted at rest by policy.
export function document(auth) {
  const kb = 100 + Math.floor(Math.random() * 2000);
  const r = upload(auth.connections, "document", kb * 1024, 500000000 + __VU * 100000 + __ITER);
  if (r) downloadAndVerify(auth.connections, r, "document");
}

export function search(auth) {
  const category = ["outage", "document"][__ITER % 2];
  const res = http.get(`${BASE}/api/v1/files?category=${category}&size=20`, { headers: auth.dispatch, tags: { name: "search", category } });
  check(res, { "search 200": (r) => r.status === 200 });
}
