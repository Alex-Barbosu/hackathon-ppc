// Planted meter faults. Real fleets always have a few broken or tampered meters, and without
// them the insights anomaly detector (and the map) has nothing to show. A fault is a pure
// function of (meter, quarter hour) like everything else here, so retries and replays still
// resend byte-identical bodies and the idempotency guarantee is untouched.
import { rng } from "./random.js";

export type FaultKind = "spike" | "consumption_drop" | "stuck_meter" | "voltage_sag";

export interface Fault {
  kind: FaultKind;
  /** Shifts the cycle so faulty meters do not all misbehave in the same quarter hour. */
  phase: number;
}

/** About 1 meter in 25: enough to light up most counties, few enough to stay believable. */
const FAULTY_SHARE = 0.04;
const KINDS: readonly FaultKind[] = ["spike", "consumption_drop", "stuck_meter", "voltage_sag"];
/**
 * Faults recur every 16 quarter hours. The detector judges a reading against the meter's
 * previous 12, so a 16-step cycle keeps that window clean and each fault stands out.
 */
export const FAULT_CYCLE = 16;

/** Separate seed from the meter's own, so adding faults does not change any existing meter. */
export function faultFor(index: number): Fault | undefined {
  const r = rng(`fault:${index}`);
  if (r() >= FAULTY_SHARE) return undefined;
  return { kind: KINDS[Math.floor(r() * KINDS.length)] ?? "spike", phase: Math.floor(r() * FAULT_CYCLE) };
}

export interface Reading {
  kwh: number;
  voltage: number | undefined;
}

/** Applies the meter's fault to one quarter hour; `steady` is the meter's typical interval kWh. */
export function applyFault(fault: Fault, tsMs: number, intervalMs: number, steady: number, reading: Reading): Reading {
  const step = (Math.floor(tsMs / intervalMs) + fault.phase) % FAULT_CYCLE;
  switch (fault.kind) {
    // A short in the installation or a bypass being removed: one quarter hour at 12x.
    case "spike":
      return step === FAULT_CYCLE - 1 ? { ...reading, kwh: reading.kwh * 12 } : reading;
    // Typical of a bypassed meter: consumption collapses to almost nothing.
    case "consumption_drop":
      return step === FAULT_CYCLE - 1 ? { ...reading, kwh: reading.kwh * 0.03 } : reading;
    // A frozen register repeats the same value for two hours (the detector looks for 8 in a row).
    case "stuck_meter":
      return step >= FAULT_CYCLE - 8 ? { ...reading, kwh: steady } : reading;
    // An overloaded transformer: voltage below EN 50160's 207 V floor for an hour.
    case "voltage_sag":
      return step >= FAULT_CYCLE - 4 && reading.voltage !== undefined ? { ...reading, voltage: 194 + step - (FAULT_CYCLE - 4) } : reading;
  }
}
