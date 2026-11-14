import type { Category, LabRecommendation, Policy, Storage } from "../../lib/domain.ts";

export interface PolicyLine {
  category: Category;
  from: Storage;
  to: Storage;
  changed: boolean;
  reason: string;
  /** Set when the new primary is also the fallback, which leaves the category with no second path. */
  warning?: string;
}
export interface PolicyPlan { lines: PolicyLine[]; next: Policy; changed: boolean }

// Meters are driven by the simulator and never benchmarked, so a recommendation for them is
// a statement, not a measurement: it must never rewrite the policy.
const isBenchmarked = (r: LabRecommendation) => r.category !== "meter" && r.benchmarked !== false;

/** Copies the policy and changes `primary` only, for benchmarked categories. Never mutates its input. */
export function planPolicyChange(current: Policy, recs: readonly LabRecommendation[]): PolicyPlan {
  const categories: Policy["categories"] = structuredClone(current.categories);
  const lines: PolicyLine[] = [];
  for (const r of recs.filter(isBenchmarked)) {
    const entry = categories[r.category];
    const from = entry.primary;
    entry.primary = r.storage;
    lines.push({
      category: r.category, from, to: r.storage, changed: from !== r.storage, reason: r.reason,
      ...(r.storage === entry.fallback ? { warning: `The fallback is also ${r.storage}, so this category loses its second path.` } : {}),
    });
  }
  return { lines, next: { ...current, categories }, changed: lines.some((l) => l.changed) };
}
