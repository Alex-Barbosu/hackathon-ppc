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

const by = (recs: ReturnType<typeof recommend>, c: Category) => recs.find((x) => x.category === c)!;
// Realistic matrix: S3 is fastest for documents, FTPS is slowest, video only works on S3.
const matrix = () => [
  cell("outage", "db", 280, 65, 24), cell("outage", "s3", 210, 98, 25), cell("outage", "ftp", 650, 430, 12),
  cell("document", "db", 109, 55, 23), cell("document", "s3", 80, 48, 28), cell("document", "ftp", 370, 416, 6.9),
  cell("video", "db", 1, 1, 1, 2), cell("video", "s3", 2400, 1200, 51), cell("video", "ftp", 1, 1, 1, 2),
];

test("every storage stays in use: documents are kept on FTPS although S3 is faster, and the reason says both", () => {
  const recs = recommend(matrix());
  assert.deepEqual(new Set(recs.map((r) => r.storage)), new Set(["db", "s3", "ftp"]));
  const doc = by(recs, "document");
  assert.equal(doc.storage, "ftp");
  assert.equal(
    doc.reasons[1],
    "S3 was faster for documents (write p95 80 ms vs 370 ms on FTPS), but documents stay on FTPS: it keeps the encrypted-document audit trail on a separate service, and the brief requires every storage to be in use.",
  );
  assert.match(doc.reason, /S3 was faster for documents/);
});

test("the numbers of both storages are kept as source chips", () => {
  const doc = by(recommend(matrix()), "document");
  const chips = Object.fromEntries(doc.evidence.map((e) => [e.label, e.value]));
  assert.equal(chips["write p95"], "370 ms");
  assert.equal(chips["S3 write p95"], "80 ms");
});

test("the category that loses least is the one that gives way", () => {
  // Outage would also lose by moving to FTPS, but far more than documents.
  const recs = recommend(matrix());
  assert.equal(by(recs, "outage").storage, "s3");
  assert.equal(by(recs, "video").storage, "s3");
  assert.equal(by(recs, "meter").storage, "db");
});

test("when FTPS failed its samples nothing can be pinned to it, and nothing breaks", () => {
  const cells = matrix().map((c) => (c.category === "document" && c.storage === "ftp" ? cell("document", "ftp", 1, 1, 1, 3) : c));
  const doc = by(recommend(cells), "document");
  assert.equal(doc.storage, "s3");
});
