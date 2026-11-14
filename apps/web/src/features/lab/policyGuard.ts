import type { LabRecommendation, Policy, Storage } from "../../lib/domain.ts";
import { planPolicyChange, type PolicyPlan } from "./policyMerge.ts";

export interface PolicyProblem { code: "STORAGE_UNUSED" | "FALLBACK_EQUALS_PRIMARY" | "METER_MOVED"; message: string }

const STORAGES: readonly Storage[] = ["db", "s3", "ftp"];
const NAME: Record<Storage, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS" };
const LABEL: Record<string, string> = { meter: "Meters", outage: "Outage records", document: "Documents", video: "Drone video" };

/**
 * Blocking problems with a proposed policy, in plain words; empty means it may be applied.
 * `current` is only used to say what a problem would change, never to excuse one: a proposal is
 * judged on what it would put in force.
 */
export function validatePolicyChange(current: Policy, proposed: Policy): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  const entries = Object.entries(proposed.categories) as Array<[string, Policy["categories"]["meter"]]>;
  for (const s of STORAGES) {
    if (!entries.some(([, c]) => c.primary === s)) {
      problems.push({ code: "STORAGE_UNUSED", message: `${NAME[s]} would not be the primary storage of any category. Brief gating 2: FTP, S3 and the database must each be really used.` });
    }
  }
  for (const [category, c] of entries) {
    if (c.fallback === c.primary) {
      problems.push({ code: "FALLBACK_EQUALS_PRIMARY", message: `${LABEL[category] ?? category}: the fallback is the same as the primary (${NAME[c.primary]}). A fallback must be a different storage, or the category has no second path.` });
    }
  }
  if (proposed.categories.meter.primary !== "db") {
    const from = current.categories.meter.primary;
    problems.push({ code: "METER_MOVED", message: `Meters must stay on PostgreSQL${from === "db" ? "" : ` (they are on ${NAME[from]} now)`}: its unique constraint is what stops a retried reading from being stored twice.` });
  }
  return problems;
}

export interface PolicyReview { plan: PolicyPlan; problems: PolicyProblem[] }

/** The plan for a recommendation together with everything that blocks it. */
export function reviewPolicyChange(current: Policy, recs: readonly LabRecommendation[]): PolicyReview {
  const plan = planPolicyChange(current, recs);
  return { plan, problems: validatePolicyChange(current, plan.next) };
}
