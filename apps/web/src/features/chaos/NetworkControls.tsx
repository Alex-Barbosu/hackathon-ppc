import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "../../components/ui";
import { useChaosAction } from "./useChaos";

const TARGETS = ["client", "db", "s3", "ftp"] as const;
type Target = (typeof TARGETS)[number];

function Slider({ label, unit, max, value, onChange, disabled }: {
  label: string; unit: string; max: number; value: number; onChange: (v: number) => void; disabled: boolean;
}) {
  return (
    <label className="block text-[13px] text-muted">
      <span className="flex justify-between"><span>{label}</span><span className="text-ink tabular-nums">{value} {unit}</span></span>
      <input type="range" min={0} max={max} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-accent" />
    </label>
  );
}

export function NetworkControls({ locked }: { locked: boolean }) {
  const act = useChaosAction();
  const [target, setTarget] = useState<Target>("client");
  const [latencyMs, setLatency] = useState(0);
  const [lossPct, setLoss] = useState(0);
  const [bandwidthKbps, setBw] = useState(0);
  const apply = (body: { latencyMs: number; lossPct: number; bandwidthKbps: number }) =>
    act.mutate({ kind: "network", body: { target, ...body } });
  const clear = () => { setLatency(0); setLoss(0); setBw(0); apply({ latencyMs: 0, lossPct: 0, bandwidthKbps: 0 }); };
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Network target" className="flex gap-1">
        {TARGETS.map((t) => (
          <button key={t} type="button" aria-pressed={t === target} onClick={() => setTarget(t)}
            className={`label rounded-lg px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent ${t === target ? "bg-accent-soft text-ink" : "bg-surface text-muted hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>
      <Slider label="Latency" unit="ms" max={2000} value={latencyMs} onChange={setLatency} disabled={locked} />
      <Slider label="Connection loss" unit="%" max={50} value={lossPct} onChange={setLoss} disabled={locked} />
      <Slider label="Bandwidth cap (0 = none)" unit="kbit/s" max={10000} value={bandwidthKbps} onChange={setBw} disabled={locked} />
      <div className="flex gap-2">
        <PrimaryButton disabled={locked || act.isPending} onClick={() => apply({ latencyMs, lossPct, bandwidthKbps })}>Apply to {target}</PrimaryButton>
        <SecondaryButton disabled={locked || act.isPending} onClick={clear}>Clear</SecondaryButton>
      </div>
    </div>
  );
}
