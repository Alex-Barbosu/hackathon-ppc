import { useState } from "react";
import { Drawer } from "../../components/Drawer";
import { usePanels } from "../../state/panels";
import { ConfirmButton } from "./ConfirmButton";
import { CorruptControl } from "./CorruptControl";
import { LoadControls } from "./LoadControls";
import { NetworkControls } from "./NetworkControls";
import { StorageControls } from "./StorageControls";
import { Timeline } from "./Timeline";
import { useChaosAction, useChaosState } from "./useChaos";

type Tab = "controls" | "timeline";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 border-t-[0.8px] border-line px-6 py-5 first:border-0"><h3 className="label text-faint">{title}</h3>{children}</section>;
}

// Admin only (the Shell renders it only for roles with chaos access; chaos-control enforces it too).
export function ChaosDock() {
  const open = usePanels((s) => s.open === "chaos");
  const close = usePanels((s) => s.close);
  const [tab, setTab] = useState<Tab>("controls");
  const { data: state } = useChaosState();
  const reset = useChaosAction();
  const title = (
    <div className="flex items-center gap-3">
      <p className="font-display text-2xl">Chaos</p>
      <div role="tablist" className="flex gap-1">
        {(["controls", "timeline"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={`label rounded-lg px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent ${tab === t ? "bg-accent-soft text-ink" : "bg-surface text-muted hover:text-ink"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
  return (
    <Drawer open={open} label="Chaos controls" title={title} onClose={close}>
      {tab === "timeline" ? <div className="p-6"><Timeline state={state} /></div> : (
        <>
          <Section title="Storages"><StorageControls state={state} locked={false} /></Section>
          <Section title="Network"><NetworkControls locked={false} /></Section>
          <Section title="Load"><LoadControls locked={false} /></Section>
          <Section title="Integrity"><CorruptControl locked={false} /></Section>
          <Section title="Reset">
            <ConfirmButton label="Reset everything" confirmLabel="Confirm reset" disabled={reset.isPending} onConfirm={() => reset.mutate({ kind: "reset" })} />
          </Section>
        </>
      )}
    </Drawer>
  );
}
