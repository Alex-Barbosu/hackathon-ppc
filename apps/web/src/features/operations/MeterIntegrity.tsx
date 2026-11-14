import { integrityState } from "./integrityState";
import { Q } from "./prom";
import { usePromQuery } from "./usePromQuery";

type Series = Map<string, number | null> | undefined;
const fmt = (v: number | null) => (v == null ? "–" : v.toLocaleString("en-GB"));
// A series that is absent is not the same as one that is zero; Map.has tells them apart.
const present = (m: Series): number | undefined => (m?.has("") ? (m.get("") ?? undefined) : undefined);

export function MeterIntegrity() {
  const sent = usePromQuery(Q.simSent).data?.get("") ?? null;
  const state = integrityState(sent, present(usePromQuery(Q.storedAccepted).data), present(usePromQuery(Q.storedDuplicates).data));
  return (
    <section aria-label="Meter integrity" className="rounded-card border border-line bg-surface p-6">
      <h3 className="font-display text-lg">Meter integrity</h3>
      {state.kind === "no-api" ? (
        <>
          <p className="mt-4 text-sm">No readings reported by the API yet. Is the simulator pointed at the real API?</p>
          <p className="mt-2 text-[13px] text-muted tabular-nums">The simulator reports {fmt(state.sent)} readings sent. Stored counts only come from filegrid_meter_readings_total.</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-muted">
            {state.kind === "equal" ? "Every reading sent is stored once." : "The counts differ. Readings may still be in flight, or a service restarted and reset its counter."}
          </p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-2xl tabular-nums sm:text-3xl">
            <span>sent {fmt(state.sent)}</span>
            <span className={state.kind === "equal" ? "text-muted" : "text-warn"} aria-label={state.kind === "equal" ? "equals" : "does not equal"}>
              {state.kind === "equal" ? "=" : "≠"}
            </span>
            <span>stored {fmt(state.stored)}</span><span className="text-muted">,</span>
            <span>duplicates rejected {fmt(state.duplicates)}</span>
          </p>
          <p className="mt-2 text-[13px] text-muted">Stored is the API's own count: filegrid_meter_readings_total.</p>
        </>
      )}
    </section>
  );
}
