import assert from "node:assert/strict";
import { test } from "node:test";
import type { LabRecommendation, Policy } from "../../lib/domain.ts";
import { planPolicyChange } from "./policyMerge.ts";
import { policyErrorText } from "./policyError.ts";

const cat = (primary: "db" | "s3" | "ftp", fallback: "db" | "s3" | "ftp" | "spool", extra = {}) =>
  ({ primary, fallback, encrypt: false, audit: false, maxSizeMb: 20, priority: "normal", workers: 4, queue: 200, ...extra }) as const;
const current: Policy = {
  version: 7,
  categories: {
    meter: cat("db", "spool", { maxSizeMb: 1, priority: "high", workers: 16, queue: 5000 }),
    outage: cat("s3", "db", { priority: "high", workers: 8 }),
    document: cat("ftp", "s3", { encrypt: true, audit: true }),
    video: cat("s3", "spool", { maxSizeMb: 5000, chunkMb: 16 }),
  },
};
const rec = (category: LabRecommendation["category"], storage: LabRecommendation["storage"], benchmarked = true): LabRecommendation =>
  ({ category, storage, reason: `${storage} wins`, benchmarked });

test("only primary changes; every other field of every category is kept", () => {
  const plan = planPolicyChange(current, [rec("outage", "s3"), rec("document", "db"), rec("video", "s3")]);
  assert.equal(plan.next.categories.document.primary, "db");
  assert.deepEqual({ ...plan.next.categories.document, primary: "ftp" }, current.categories.document);
  for (const c of ["outage", "video"] as const) assert.deepEqual(plan.next.categories[c], current.categories[c]);
  assert.equal(plan.next.version, 7);
});

test("meter is untouched even when it is recommended a different storage", () => {
  const plan = planPolicyChange(current, [rec("meter", "s3", false), rec("meter", "ftp", true)]);
  assert.deepEqual(plan.next.categories.meter, current.categories.meter);
  assert.equal(plan.lines.length, 0);
});

test("lines say what changes and carry the reason", () => {
  const plan = planPolicyChange(current, [rec("outage", "s3"), rec("document", "db")]);
  assert.deepEqual(plan.lines.map((l) => [l.category, l.from, l.to, l.changed]), [["outage", "s3", "s3", false], ["document", "ftp", "db", true]]);
  assert.equal(plan.lines[1]?.reason, "db wins");
  assert.equal(plan.changed, true);
});

test("a recommendation equal to the current policy changes nothing", () => {
  const plan = planPolicyChange(current, [rec("outage", "s3"), rec("document", "ftp"), rec("video", "s3")]);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.next, current);
});

test("the input policy is never mutated", () => {
  const before = structuredClone(current);
  planPolicyChange(current, [rec("document", "db")]);
  assert.deepEqual(current, before);
});

test("a new primary equal to the fallback is flagged", () => {
  const plan = planPolicyChange(current, [rec("document", "s3")]);
  assert.match(plan.lines[0]?.warning ?? "", /fallback is also s3/);
  assert.equal(planPolicyChange(current, [rec("document", "db")]).lines[0]?.warning, undefined);
});

test("server error codes read as plain words, unknown codes as themselves", () => {
  assert.match(policyErrorText("FORBIDDEN", 403), /Only an admin/);
  assert.match(policyErrorText("BAD_REQUEST", 400), /invalid/);
  assert.equal(policyErrorText("SOMETHING_NEW", 418), "SOMETHING_NEW");
  assert.match(policyErrorText(undefined, 502), /answered 502/);
});
