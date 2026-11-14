import { useState } from "react";
import { FIELD, PrimaryButton, SecondaryButton } from "../../components/ui";
import { Select } from "../../components/select/Select";
import { useChaosAction } from "./useChaos";

const CATS = ["meter", "outage", "document", "video"] as const;

export function LoadControls({ locked }: { locked: boolean }) {
  const act = useChaosAction();
  const [category, setCategory] = useState<(typeof CATS)[number]>("outage");
  const [multiplier, setMultiplier] = useState(10);
  const [durationSec, setDuration] = useState(60);
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-sm font-medium">Storm</legend>
        <div className="grid grid-cols-3 gap-2">
          <Select label="Storm category" hideLabel value={category} disabled={locked} options={CATS.map((c) => ({ value: c, label: c }))} onChange={setCategory} />
          <input aria-label="Multiplier" type="number" min={1} max={50} className={`${FIELD} tabular-nums`} value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} />
          <input aria-label="Duration in seconds" type="number" min={10} max={1800} className={`${FIELD} tabular-nums`} value={durationSec} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <p className="text-[13px] text-muted">Multiplier × baseline, for the given seconds.</p>
        <PrimaryButton disabled={locked || act.isPending} onClick={() => act.mutate({ kind: "storm", category, multiplier, durationSec })}>
          Fire {category} storm ×{multiplier}
        </PrimaryButton>
      </fieldset>
      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-sm font-medium">Meters</legend>
        <div className="flex gap-2">
          <SecondaryButton disabled={locked || act.isPending} onClick={() => act.mutate({ kind: "meters", readingsPerSec: 10 })}>Normal day</SecondaryButton>
          <SecondaryButton disabled={locked || act.isPending} onClick={() => act.mutate({ kind: "meters", readingsPerSec: 100 })}>Peak day</SecondaryButton>
        </div>
      </fieldset>
    </div>
  );
}
