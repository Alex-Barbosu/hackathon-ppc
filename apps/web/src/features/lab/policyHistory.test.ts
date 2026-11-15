import assert from "node:assert/strict";
import { test } from "node:test";
import type { Policy } from "../../lib/domain.ts";
import { diffPolicies, rollbackBody } from "./policyHistory.ts";

const cat = (primary: "db" | "s3" | "ftp", workers = 4) => ({ primary, fallback: "spool" as const, encrypt: false, maxSizeMb: 20, priority: "normal" as const, workers, queue: 100, audit: false });
const base: Policy = { version: 1, categories: { meter: cat("db"), outage: cat("s3", 8), document: cat("ftp"), video: cat("s3") } };

test("diff lists each changed setting once, with before and after", () => {
  const next: Policy = { ...base, version: 2, categories: { ...base.categories, outage: cat("db", 16) } };
  assert.deepEqual(diffPolicies(base, next), [
    { category: "outage", field: "primary", from: "s3", to: "db" },
    { category: "outage", field: "workers", from: "8", to: "16" },
  ]);
  assert.deepEqual(diffPolicies(base, base), []);
});

test("rollback body drops null settings the schema would refuse", () => {
  const withNull = { ...base, categories: { ...base.categories, video: { ...cat("s3"), chunkMb: null } } } as unknown as Policy;
  assert.equal("chunkMb" in rollbackBody(withNull).categories.video, false);
});
