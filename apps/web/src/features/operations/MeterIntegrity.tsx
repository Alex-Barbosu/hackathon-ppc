import { Ticker } from "../../components/motion/Ticker";
import { Chip } from "../../components/ui";
import { integrityState } from "./integrityState";
import { Q, WINDOW_LABEL } from "./prom";
import { usePromQuery } from "./usePromQuery";

type Series = Map<string, number | null> | undefined;
const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
// A series that is absent is not the same as one that is zero; Map.has tells them apart.
const present = (m: Series): number | undefined => (m?.has("") ? (m.get("") ?? undefined) : undefined);

function Stat({ label, value, sub }: { label: string; value: number | null; sub: string }) {
  return (
    <div className="flex flex-col gap-2 border-t-[0.8px] border-white/16 pt-4">
      <p className="label text-white/70">{label}</p>
      <p className="font-display text-[44px] leading-none tabular-nums sm:text-[56px]"><Ticker value={value} format={whole} /></p>
      <p className="text-[13px] text-white/70">{sub}</p>
    </div>
  );
}

export function MeterIntegrity() {
  const acked = usePromQuery(Q.simAcked).data?.get("") ?? null;
  const state = integrityState(acked, present(usePromQuery(Q.storedAccepted).data), present(usePromQuery(Q.storedDuplicates).data));
  const equal = state.kind === "equal" || state.kind === "in-step";
  return (
    <section aria-label="Meter integrity" className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label text-white/75">Meter integrity · {WINDOW_LABEL}</p>
        {state.kind === "no-api" ? <Chip tone="warn">API not reporting</Chip> : <Chip tone={equal ? "good" : "warn"}>{state.kind === "equal" ? "Every reading stored once" : equal ? "In step" : "Counts differ"}</Chip>}
      </div>
      <h3 className="font-display text-[28px] leading-[1.15] text-white/90 sm:text-4xl">
        {state.kind === "no-api" ? <>No readings reported by the API <em>yet</em>.</> : equal ? <>Nothing lost, nothing <em>doubled</em>.</> : <>Some readings are still in <em>flight</em>.</>}
      </h3>
      {state.kind === "in-step" && <p className="-mt-4 max-w-2xl text-[15px] text-white/75">The two counters are read up to 5 seconds apart, so while meters send they sit {state.gap} {state.gap === 1 ? "reading" : "readings"} apart. Stop the meters and they meet.</p>}
      <div className="grid gap-6 sm:grid-cols-3">
        <Stat label="Acknowledged" value={state.acked} sub="Acks the simulator received" />
        <Stat label="Stored" value={state.kind === "no-api" ? null : state.stored} sub="The API's own count" />
        <Stat label="Duplicates rejected" value={state.kind === "no-api" ? null : state.duplicates} sub="Retries caught by the idempotency key" />
      </div>
      <details className="text-[13px] text-white/70">
        <summary className="cursor-pointer select-none hover:text-white">How this is counted</summary>
        <p className="mt-2 max-w-2xl">Acknowledged comes from meter_sim_acked_total, stored from filegrid_meter_readings_total, both as increases over the {WINDOW_LABEL} so restarts do not skew them. A few readings accepted just before a restart can still be missing from the API's count.</p>
      </details>
    </section>
  );
}
