// Zone B. Storm day: outage uploads at 10x the baseline rate, 5 MB each, while documents
// keep their normal rate. Proves NFR scalability: the outage spike must not degrade the
// other categories (watch meter p95 on FileGrid Overview; documents are measured here).
//   make b-load S=storm-outage [DURATION=2m] [MULTIPLIER=10]
import { BASE, login, upload, summaryTrendStats } from "./lib/common.js";
import http from "k6/http";
import { check } from "k6";

const DURATION = __ENV.DURATION || "2m";
const MULTIPLIER = Number(__ENV.MULTIPLIER || 10);
const OUTAGE_BASE_PER_SEC = Number(__ENV.OUTAGE_PER_SEC || 0.2);
const OUTAGE_MB = Number(__ENV.OUTAGE_MB || 5);

export const options = {
  insecureSkipTLSVerify: true,
  summaryTrendStats,
  scenarios: {
    // Open model: arrivals do not wait for responses, as in a real storm. If FileGrid slows
    // down, k6 adds VUs (up to maxVUs) and dropped_iterations shows what it could not send.
    storm: {
      executor: "constant-arrival-rate",
      rate: Math.round(OUTAGE_BASE_PER_SEC * MULTIPLIER * 60),
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 60,
      exec: "outage",
    },
    // The bystander: documents at their normal rate during the storm.
    documents: { executor: "constant-arrival-rate", rate: 30, timeUnit: "1m", duration: DURATION, preAllocatedVUs: 2, maxVUs: 10, exec: "document" },
  },
  thresholds: {
    // Isolation: the bystander category stays fast and healthy whatever the storm does.
    // Request-level failures include the ones the client retried; the checks below count
    // uploads that ended stored. 5 % tolerates the requests in flight on a removed replica.
    "http_req_failed{scenario:documents}": ["rate<0.05"],
    "http_req_duration{scenario:documents,name:upload}": ["p(95)<3000"],
    // The storm itself must be absorbed, not dropped.
    "http_req_failed{scenario:storm}": ["rate<0.05"],
    // Every upload ends stored (after client retries, if a replica went away).
    "checks{check:outage upload 201}": ["rate>0.99"],
    "checks{check:document upload 201}": ["rate>0.99"],
  },
};

export function setup() {
  return { dispatch: login("dispatch"), connections: login("connections") };
}

export function outage(auth) {
  upload(auth.dispatch, "outage", OUTAGE_MB * 1024 * 1024, __VU * 1000000 + __ITER, { storm: "yes" });
}

export function document(auth) {
  upload(auth.connections, "document", 512 * 1024, 500000000 + __VU * 100000 + __ITER);
}

export function teardown(auth) {
  // The storm's files are real outage records; one query shows they are all findable.
  const res = http.get(`${BASE}/api/v1/files?category=outage&q=k6&size=1`, { headers: auth.dispatch, tags: { name: "search" } });
  check(res, { "storm files searchable": (r) => r.status === 200 && r.json("total") > 0 });
}
