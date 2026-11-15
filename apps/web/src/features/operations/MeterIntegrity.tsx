import { Ticker } from "../../components/motion/Ticker";
import { Chip } from "../../components/ui";
import { integrityState } from "./integrityState";
import { Q, WINDOW_LABEL } from "./prom";
import { usePromQuery } from "./usePromQuery";

type Series = Map<string, number | null> | undefined;
const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
// A series that is absent is not the same as one that is zero; Map.has tells them apart.
const present = (m: Series): number | undefined => (m?.has("") ? (m.get("") ?? undefined) : undefined);

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-2 border-t-[0.8px] border-white/16 pt-4">
      <p className="caption text-muted">{label}</p>
      <p className="font-display text-[32px] leading-none tabular-nums sm:text-[40px]"><Ticker value={value} format={whole} /></p>
    </div>
  );
}

export function MeterIntegrity() {
  const acked = usePromQuery(Q.simAcked).data?.get("") ?? null;
  const state = integrityState(acked, present(usePromQuery(Q.storedAccepted).data), present(usePromQuery(Q.storedDuplicates).data));
  const equal = state.kind === "equal" || state.kind === "in-step";
  return (
    <section aria-label="Meter integrity" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="caption text-muted">Meter integrity, {WINDOW_LABEL}</p>
        {state.kind === "no-api" ? <Chip tone="warn">API not reporting</Chip> : <Chip tone={equal ? "good" : "warn"}>{state.kind === "equal" ? "Every reading stored once" : equal ? "In step" : "Counts differ"}</Chip>}
      </div>
      <h3 className="text-lg font-normal">
        {state.kind === "no-api" ? <>No readings reported by the API <em>yet</em>.</> : equal ? <>Nothing lost, nothing <em>doubled</em>.</> : <>Some readings are still in <em>flight</em>.</>}
      </h3>
      <div className="grid gap-6 sm:grid-cols-3">
        <Stat label="Acknowledged" value={state.acked} />
        <Stat label="Stored" value={state.kind === "no-api" ? null : state.stored} />
        <Stat label="Duplicates rejected" value={state.kind === "no-api" ? null : state.duplicates} />
      </div>
    </section>
  );
}
