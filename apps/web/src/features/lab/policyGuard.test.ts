import assert from "node:assert/strict";
import { test } from "node:test";
import type { LabRecommendation, Policy } from "../../lib/domain.ts";
import { reviewPolicyChange, validatePolicyChange } from "./policyGuard.ts";

const cat = (primary: "db" | "s3" | "ftp", fallback: "db" | "s3" | "ftp" | "spool") =>
  ({ primary, fallback, encrypt: false, audit: false, maxSizeMb: 20, priority: "normal", workers: 4, queue: 200 }) as const;
const current: Policy = {
  version: 5,
  categories: { meter: cat("db", "spool"), outage: cat("s3", "db"), document: cat("ftp", "s3"), video: cat("s3", "spool") },
};
const withDoc = (primary: "db" | "s3" | "ftp", fallback: "db" | "s3" | "ftp" | "spool"): Policy => ({
  ...current, categories: { ...current.categories, document: cat(primary, fallback) },
});
const rec = (category: LabRecommendation["category"], storage: LabRecommendation["storage"]): LabRecommendation => ({ category, storage, reason: "r", benchmarked: true });

test("the policy in force is valid", () => {
  assert.deepEqual(validatePolicyChange(current, current), []);
});

test("a change that keeps every storage in use, fallbacks different and meter on db, is valid", () => {
  // FTPS stays primary somewhere (video), documents move to PostgreSQL.
  const proposed: Policy = { ...current, categories: { ...current.categories, document: cat("db", "s3"), video: cat("ftp", "spool") } };
  assert.deepEqual(validatePolicyChange(current, proposed), []);
});

test("moving the only FTPS category away leaves FTPS unused and names the brief", () => {
  const problems = validatePolicyChange(current, withDoc("db", "s3"));
  assert.deepEqual(problems.map((p) => p.code), ["STORAGE_UNUSED"]);
  assert.match(problems[0]!.message, /FTPS would not be the primary storage of any category/);
  assert.match(problems[0]!.message, /Brief gating 2/);
});

test("documents on s3 with fallback s3 breaks both rules", () => {
  const problems = validatePolicyChange(current, withDoc("s3", "s3"));
  assert.deepEqual(problems.map((p) => p.code).sort(), ["FALLBACK_EQUALS_PRIMARY", "STORAGE_UNUSED"]);
  assert.match(problems.find((p) => p.code === "FALLBACK_EQUALS_PRIMARY")!.message, /Documents: the fallback is the same as the primary \(S3\)/);
});

test("primary equal to fallback is blocked even when every storage is used", () => {
  const proposed: Policy = { ...current, categories: { ...current.categories, outage: cat("s3", "s3"), video: cat("db", "spool") } };
  assert.deepEqual(validatePolicyChange(current, proposed).map((p) => p.code), ["FALLBACK_EQUALS_PRIMARY"]);
});

test("meter must stay on the database", () => {
  const proposed: Policy = { ...current, categories: { ...current.categories, meter: cat("s3", "spool"), video: cat("db", "spool") } };
  assert.deepEqual(validatePolicyChange(current, proposed).map((p) => p.code), ["METER_MOVED"]);
});

test("a fallback of spool never equals a primary", () => {
  assert.deepEqual(validatePolicyChange(current, withDoc("ftp", "spool")), []);
});

test("review of a recommendation that moves documents to s3 is blocked with reasons, not hidden", () => {
  const { plan, problems } = reviewPolicyChange(current, [rec("outage", "s3"), rec("document", "s3"), rec("video", "s3")]);
  assert.equal(plan.changed, true);
  assert.ok(problems.length >= 2);
});

test("review of a recommendation equal to the policy has no problems and no change", () => {
  const { plan, problems } = reviewPolicyChange(current, [rec("outage", "s3"), rec("document", "ftp"), rec("video", "s3")]);
  assert.equal(plan.changed, false);
  assert.deepEqual(problems, []);
});
