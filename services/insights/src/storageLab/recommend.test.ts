import assert from "node:assert/strict";
import { test } from "node:test";
import { recommend } from "./recommend.js";
import { percentile } from "./stats.js";
import type { Category, Cell, Storage } from "./types.js";

const cell = (category: Category, storage: Storage, w: number, r: number, mbps: number, errors = 0): Cell => ({
  category, storage, status: "done", samples: 5, completed: 5, sizeBytes: 2e6, method: "multipart",
  write: { p50Ms: w, p95Ms: w, p99Ms: w }, read: { p50Ms: r, p95Ms: r, p99Ms: r },
  throughputMBps: mbps, errors, errorSamples: errors ? ["upload:TOO_LARGE"] : [], integrityOk: true,
});

test("percentile uses nearest rank", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
});

test("outage goes to the fastest storage, with numbers in the reason", () => {
  const r = recommend([cell("outage", "db", 300, 200, 15), cell("outage", "s3", 100, 60, 45), cell("outage", "ftp", 400, 250, 10)]).find((x) => x.category === "outage")!;
  assert.equal(r.storage, "s3");
  assert.match(r.reason, /100 ms/);
});

test("document keeps ftp for the audit trail when it is only a little slower", () => {
  const r = recommend([cell("document", "db", 80, 50, 30), cell("document", "s3", 70, 45, 34), cell("document", "ftp", 90, 55, 28)]).find((x) => x.category === "document")!;
  assert.equal(r.storage, "ftp");
  assert.ok(r.reasons.some((x) => /faster on raw numbers/.test(x)));
});

test("a storage with errors is ruled out and the reason says why", () => {
  const r = recommend([cell("video", "db", 1, 1, 1, 2), cell("video", "s3", 900, 800, 100), cell("video", "ftp", 1, 1, 1, 2)]).find((x) => x.category === "video")!;
  assert.equal(r.storage, "s3");
  assert.ok(r.reasons.some((x) => /ruled out.*upload:TOO_LARGE/.test(x)));
});

test("meters get the database with the dedup reason and no benchmark claim", () => {
  const r = recommend([]).find((x) => x.category === "meter")!;
  assert.equal(r.storage, "db");
  assert.equal(r.benchmarked, false);
});

test("when the fit loses clearly, the reason names what it would have given", () => {
  const r = recommend([cell("document", "db", 90, 35, 24), cell("document", "s3", 270, 100, 18), cell("document", "ftp", 170, 330, 12)]).find((x) => x.category === "document")!;
  assert.equal(r.storage, "db");
  assert.ok(r.reasons.some((x) => /audit trail.*outweighs that guarantee/.test(x)));
});
