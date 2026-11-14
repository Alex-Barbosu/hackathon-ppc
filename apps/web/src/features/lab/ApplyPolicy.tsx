import type { LabRecommendation } from "../../lib/domain";
import { useSession } from "../../state/session";
import { PolicyDiff } from "./PolicyDiff";
import { reviewPolicyChange } from "./policyGuard";
import { useApplyPolicy } from "./useApplyPolicy";
import { usePolicy } from "./useLab";

export function ApplyPolicy({ recs }: { recs: readonly LabRecommendation[] }) {
  const admin = useSession((s) => s.session?.role === "admin");
  const policy = usePolicy();
  const { prepare, apply } = useApplyPolicy(recs);
  // Judged continuously from the live policy, so a blocked change is visible before anyone clicks.
  const live = policy.data ? reviewPolicyChange(policy.data, recs) : null;
  const blocked = live !== null && live.problems.length > 0;
  const matches = live !== null && !live.plan.changed;
  const why = !admin ? "Applying a policy needs the admin role."
    : blocked ? "Blocked: this change breaks a rule, see below."
    : matches ? "Current policy already matches the measurements." : null;
  const shown = prepare.data ?? (blocked && admin ? live : null);
  const error = prepare.error ?? apply.error;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Disabled controls swallow hover, so the reason is visible text, not only a tooltip. */}
        <span title={why ?? undefined}>
          <button type="button" disabled={why !== null || !policy.data || prepare.isPending || prepare.isSuccess} aria-describedby="apply-why"
            onClick={() => { apply.reset(); prepare.mutate(); }}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
            Apply policy
          </button>
        </span>
        <p id="apply-why" className="text-[13px] text-muted">{why}</p>
      </div>
      {shown && (
        <PolicyDiff plan={shown.plan} problems={shown.problems} saving={apply.isPending} onCancel={() => prepare.reset()}
          onConfirm={() => apply.mutate(shown.plan.next)} />
      )}
      {apply.data && (
        <p role="status" className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent tabular-nums">
          Applied, no restart. Policy version {apply.data.version} is in force.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error.message}</p>}
    </div>
  );
}
