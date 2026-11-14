import { PrimaryButton, SecondaryButton } from "../../components/ui";
import { STORAGE_NAME } from "./constants";
import type { PolicyPlan } from "./policyMerge";

const LABEL: Record<string, string> = { outage: "Outage records", document: "Documents", video: "Drone video" };

export function PolicyDiff({ plan, saving, onConfirm, onCancel }: {
  plan: PolicyPlan; saving: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-4 rounded-card border border-line bg-surface p-6" role="region" aria-label="Policy change preview">
      <h3 className="font-display text-lg">This will change the policy</h3>
      <ul className="space-y-3">
        {plan.lines.map((l) => (
          <li key={l.category} className="border-l-2 border-accent/40 pl-3">
            <p className="text-sm tabular-nums">
              <span className="font-medium">{LABEL[l.category] ?? l.category}:</span> {STORAGE_NAME[l.from]} → {STORAGE_NAME[l.to]}
              <span className={l.changed ? "ml-2 text-accent" : "ml-2 text-muted"}>{l.changed ? "changes" : "(no change)"}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-muted">{l.reason}</p>
            {l.warning && <p className="mt-0.5 text-[13px] text-warn">{l.warning}</p>}
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted">Only the primary storage changes. Every other setting, and meters, stay as they are. It takes effect without a restart.</p>
      <div className="flex gap-2">
        <PrimaryButton disabled={saving} onClick={onConfirm}>{saving ? "Applying" : "Confirm and apply"}</PrimaryButton>
        <SecondaryButton disabled={saving} onClick={onCancel}>Cancel</SecondaryButton>
      </div>
    </div>
  );
}
