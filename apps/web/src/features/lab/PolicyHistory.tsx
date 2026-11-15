import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { SPRING } from "../../components/motion/springs";
import { SecondaryButton, WIDGET } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useSession } from "../../state/session";
import { diffPolicies } from "./policyHistory";
import { usePolicyHistory, useRollback } from "./usePolicyHistory";

const LABEL: Record<string, string> = { meter: "Meters", outage: "Outage records", document: "Documents", video: "Drone video" };

// Every policy version, what it changed against the one before, and a one-click way back.
export function PolicyHistory() {
  const admin = useSession((s) => s.session?.role === "admin");
  const { data, isPending, isError } = usePolicyHistory();
  const rollback = useRollback();
  const [open, setOpen] = useState<number | null>(null);
  const versions = data ?? [];
  const current = versions[0];
  return (
    <section aria-label="Policy history" className={WIDGET}>
      {isPending && <div className="m-5 h-24 animate-pulse rounded-lg bg-white/5" />}
      {isError && <p className="p-5 text-sm text-muted">Policy history could not be read.</p>}
      <ul className="divide-y divide-line">
        {versions.slice(0, 8).map((v, i) => {
          const before = versions[i + 1];
          const changes = before ? diffPolicies(before.policy, v.policy) : [];
          const expanded = open === v.version;
          return (
            <li key={v.version}>
              <button type="button" onClick={() => setOpen(expanded ? null : v.version)} aria-expanded={expanded}
                className="flex w-full flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5 text-left hover:bg-white/3 focus-visible:outline-2 focus-visible:outline-accent">
                <span className="text-[15px]">Version {v.version}{i === 0 && <span className="ml-3 text-[13px] text-good">in force</span>}</span>
                <span className="text-[13px] text-muted tabular-nums">
                  {before ? `${changes.length} ${changes.length === 1 ? "change" : "changes"}` : "first version"} · {v.appliedBy ?? "file"} · {formatDateTime(v.appliedAt)}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING.snappy} className="overflow-hidden">
                    <div className="space-y-3 px-5 pb-4">
                      {changes.length > 0 && (
                        <ul className="space-y-1 font-mono text-[13px]">
                          {changes.map((c) => <li key={`${c.category}.${c.field}`}><span className="text-muted">{LABEL[c.category]} {c.field}</span> <span className="text-bad/80 line-through">{c.from}</span> → <span className="text-good">{c.to}</span></li>)}
                        </ul>
                      )}
                      {i > 0 && current && admin && (
                        <SecondaryButton className="min-h-10" disabled={rollback.isPending} onClick={() => rollback.mutate(v.policy)}>
                          {rollback.isPending ? "Rolling back…" : `Roll back to version ${v.version}`}
                        </SecondaryButton>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
      {rollback.error && <p role="alert" className="border-t-[0.8px] border-line px-5 py-3 text-sm text-bad">{rollback.error.message}</p>}
      {rollback.data && <p role="status" className="border-t-[0.8px] border-line px-5 py-3 text-sm text-good">Rolled back. Version {rollback.data.version} is in force, no restart.</p>}
    </section>
  );
}
