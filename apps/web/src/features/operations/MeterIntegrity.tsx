import { Q } from "./prom";
import { usePromQuery } from "./usePromQuery";

const n = (m: Map<string, number | null> | undefined) => m?.get("") ?? null;
const fmt = (v: number | null) => (v == null ? "–" : Math.round(v).toLocaleString("en-GB"));

export function MeterIntegrity() {
  const sent = n(usePromQuery(Q.simSent).data);
  const storedApi = n(usePromQuery(Q.storedAccepted).data);
  const ackedSim = n(usePromQuery(Q.simAcked).data);
  const dupApi = n(usePromQuery(Q.storedDuplicates).data);
  const dupSim = n(usePromQuery(Q.simDuplicates).data);
  // The API counter is the proof; the simulator's acks stand in until the API emits it.
  const stored = storedApi ?? ackedSim;
  const dups = dupApi ?? dupSim;
  const gap = sent != null && stored != null ? sent - stored : null;
  const ok = gap != null && gap <= 0;
  return (
    <section aria-label="Meter integrity" className="rounded-card border border-line bg-surface p-6">
      <h3 className="font-display text-lg">Meter integrity</h3>
      <p className="mt-1 text-[13px] text-muted">
        {ok ? "Every reading sent is stored once." : gap != null ? `${fmt(gap)} readings still in flight or retrying.` : "Waiting for counters."}
      </p>
      <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-2xl tabular-nums sm:text-3xl">
        <span>sent {fmt(sent)}</span><span className="text-muted">=</span>
        <span>stored {fmt(stored)}</span><span className="text-muted">,</span>
        <span>duplicates rejected {fmt(dups)}</span>
      </p>
      <p className="mt-2 text-[13px] text-muted">
        Source: {storedApi != null ? "filegrid_meter_readings_total" : "meter_sim_acked_total (API counter not reported yet)"}
      </p>
    </section>
  );
}
