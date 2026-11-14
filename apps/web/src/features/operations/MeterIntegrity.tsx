import { integrityState } from "./integrityState";
import { Q, WINDOW_LABEL } from "./prom";
import { usePromQuery } from "./usePromQuery";

type Series = Map<string, number | null> | undefined;
const fmt = (v: number | null) => (v == null ? "–" : v.toLocaleString("en-GB"));
// A series that is absent is not the same as one that is zero; Map.has tells them apart.
const present = (m: Series): number | undefined => (m?.has("") ? (m.get("") ?? undefined) : undefined);

export function MeterIntegrity() {
  const acked = usePromQuery(Q.simAcked).data?.get("") ?? null;
  const state = integrityState(acked, present(usePromQuery(Q.storedAccepted).data), present(usePromQuery(Q.storedDuplicates).data));
  return (
    <section aria-label="Meter integrity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label text-white/75">Meter integrity</p>
        <span className="text-[13px] text-white/70">{WINDOW_LABEL}</span>
      </div>
      {state.kind === "no-api" ? (
        <>
          <p className="mt-4 text-sm">No readings reported by the API yet. Is the simulator pointed at the real API?</p>
          <p className="mt-2 text-[13px] text-white/70 tabular-nums">The simulator received {fmt(state.acked)} acknowledgements in the {WINDOW_LABEL}. Stored counts only come from filegrid_meter_readings_total.</p>
        </>
      ) : (
        <>
          <p className="mt-3 text-base text-white/85">
            {state.kind === "equal" ? "Every reading the simulator saw acknowledged is stored once." : "The counts differ. Readings may still be in flight, or the API stored readings the simulator never saw acknowledged."}
          </p>
          <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-[28px] leading-[1.2] tabular-nums sm:text-4xl">
            <span>acknowledged {fmt(state.acked)}</span>
            <span className={state.kind === "equal" ? "text-white/70" : "text-warn"} aria-label={state.kind === "equal" ? "equals" : "does not equal"}>
              {state.kind === "equal" ? "=" : "≠"}
            </span>
            <span>stored {fmt(state.stored)}</span><span className="text-white/70">,</span>
            <span>duplicates rejected {fmt(state.duplicates)}</span>
          </p>
          <p className="mt-2 text-[13px] text-white/70">Acknowledged: acks the simulator received (meter_sim_acked_total). Stored: the API's own count (filegrid_meter_readings_total). Counter resets from restarts are corrected for; a few readings accepted just before a restart can still be missing from the API's count.</p>
        </>
      )}
    </section>
  );
}
