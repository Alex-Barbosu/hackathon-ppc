export type IntegrityState =
  | { kind: "no-api"; acked: number | null }
  | { kind: "equal"; acked: number; stored: number; duplicates: number }
  | { kind: "differs"; acked: number | null; stored: number; duplicates: number };

/**
 * All three inputs are increases over the same window (see prom.ts), so a service restart does not
 * make them disagree.
 *
 * "Stored" is only ever the API's own accepted counter. The simulator's acks are the simulator's
 * word, not proof the API stored anything, so they are never substituted: if the API has
 * reported nothing, the card says so instead of showing a comforting number.
 *
 * `stored` is undefined when the series does not exist (the API never counted a reading) and a
 * number, zero included, once it does. increase() extrapolates to the window edges, so values are
 * fractional; whole readings are compared.
 */
export function integrityState(acked: number | null, stored: number | undefined, duplicates: number | undefined): IntegrityState {
  if (stored === undefined || !Number.isFinite(stored)) return { kind: "no-api", acked: acked === null ? null : Math.round(acked) };
  const dups = Math.round(duplicates ?? 0);
  const a = acked === null ? null : Math.round(acked);
  const t = Math.round(stored);
  return a !== null && a === t ? { kind: "equal", acked: a, stored: t, duplicates: dups } : { kind: "differs", acked: a, stored: t, duplicates: dups };
}
