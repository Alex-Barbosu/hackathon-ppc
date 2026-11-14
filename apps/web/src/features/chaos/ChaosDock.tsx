import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { PrimaryButton } from "../../components/ui";
import { ConfirmButton } from "./ConfirmButton";
import { CorruptControl } from "./CorruptControl";
import { LoadControls } from "./LoadControls";
import { NetworkControls } from "./NetworkControls";
import { StorageControls } from "./StorageControls";
import { Timeline } from "./Timeline";
import { useChaosAction, useChaosState, useIsAdmin } from "./useChaos";

type Tab = "controls" | "timeline";
const spring = { type: "spring", stiffness: 260, damping: 30 } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 border-t-[0.8px] border-line pt-4 first:border-0 first:pt-0"><h3 className="label text-faint">{title}</h3>{children}</section>;
}

export function ChaosDock() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("controls");
  const admin = useIsAdmin();
  const { data: state } = useChaosState();
  const reset = useChaosAction();
  const locked = !admin;
  return (
    <div className="fixed right-3 bottom-3 z-40 sm:right-6 sm:bottom-6">
      <AnimatePresence>
        {open && (
          <motion.div key="panel" role="dialog" aria-label="Chaos dock" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }} transition={spring}
            className="glass mb-3 max-h-[calc(100vh-160px)] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-card p-5 sm:w-[26rem]">
            <div role="tablist" className="mb-4 flex gap-1">
              {(["controls", "timeline"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
                  className={`label rounded-lg px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent ${tab === t ? "bg-accent-soft text-ink" : "bg-surface text-muted hover:text-ink"}`}>{t}</button>
              ))}
            </div>
            {locked && <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Read-only. Chaos actions need the admin role.</p>}
            {tab === "timeline" ? <Timeline state={state} /> : (
              <div className="space-y-4">
                <Section title="Storages"><StorageControls state={state} locked={locked} /></Section>
                <Section title="Network"><NetworkControls locked={locked} /></Section>
                <Section title="Load"><LoadControls locked={locked} /></Section>
                <Section title="Integrity"><CorruptControl locked={locked} /></Section>
                <Section title="Reset">
                  <ConfirmButton label="Reset everything" confirmLabel="Confirm reset" disabled={locked || reset.isPending} onConfirm={() => reset.mutate({ kind: "reset" })} />
                </Section>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex justify-end">
        {/* Origin's white call to action, lifted off the page with a shadow so it reads over charts. */}
        <PrimaryButton aria-expanded={open} onClick={() => setOpen((o) => !o)} className="shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)]">
          {open ? "Close chaos dock" : "Chaos dock"}
        </PrimaryButton>
      </div>
    </div>
  );
}
