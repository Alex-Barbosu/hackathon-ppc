#!/usr/bin/env node
// Fails a PR whose changed files belong to more than one owner set in CODEOWNERS.
// Why: three AI agents work in parallel; staying inside one zone per PR is what keeps
// merges conflict-free. Shared files (owned by all three) need the `contracts` or
// `base` label. Usage: node scripts/zone-guard.mjs <base-ref> [labels-json]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [baseRef = "origin/main", labelsJson = "[]"] = process.argv.slice(2);
const labels = JSON.parse(labelsJson);
if (labels.includes("contracts") || labels.includes("base")) {
  console.log(`zone-guard: skipped (label ${labels.join(", ")})`);
  process.exit(0);
}

const rules = readFileSync("CODEOWNERS", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [pattern, ...owners] = l.split(/\s+/);
    return { pattern, owners: owners.sort().join(" ") };
  });

// Supports the pattern shapes used in CODEOWNERS: "*", "/dir/", "/file".
function matches(pattern, file) {
  if (pattern === "*") return true;
  const p = pattern.replace(/^\//, "");
  return p.endsWith("/") ? file.startsWith(p) : file === p;
}

function ownerOf(file) {
  let owner = "";
  for (const r of rules) if (matches(r.pattern, file)) owner = r.owners;
  return owner;
}

const changed = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const byOwner = new Map();
for (const f of changed) {
  const o = ownerOf(f);
  byOwner.set(o, [...(byOwner.get(o) ?? []), f]);
}

const shared = rules.find((r) => r.pattern === "*")?.owners;
if (byOwner.size > 1 || (shared && byOwner.has(shared))) {
  console.error("zone-guard: this PR touches more than one zone (or a shared file):");
  for (const [owner, files] of byOwner) console.error(`  ${owner}\n    ${files.join("\n    ")}`);
  console.error("Split the PR per zone, or add the `contracts` label for an approved contract change.");
  process.exit(1);
}
console.log(`zone-guard: ok (${changed.length} files, owner: ${[...byOwner.keys()][0] ?? "none"})`);
