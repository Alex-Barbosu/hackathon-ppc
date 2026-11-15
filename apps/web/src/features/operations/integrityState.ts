export type IntegrityState =
  | { kind: "no-api"; acked: number | null }
  | { kind: "equal"; acked: number; stored: number; duplicates: number }
  | { kind: "in-step"; acked: number; stored: number; duplicates: number; gap: number }
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
 *
 * The two counters come from two services that Prometheus scrapes at different moments, up to one
 * scrape interval apart. While meters send, the readings that arrived between the two scrapes make the
 * numbers sit a few apart with nothing lost, and the card used to say "Counts differ" almost all the
 * time. A gap no larger than one scrape interval of traffic is "in-step"; anything beyond it still differs.
 */
export const SCRAPE_SECONDS = 5;
export function integrityState(acked: number | null, stored: number | undefined, duplicates: number | undefined, windowSeconds = 600): IntegrityState {
  if (stored === undefined || !Number.isFinite(stored)) return { kind: "no-api", acked: acked === null ? null : Math.round(acked) };
  const dups = Math.round(duplicates ?? 0);
  const a = acked === null ? null : Math.round(acked);
  const t = Math.round(stored);
  if (a === null) return { kind: "differs", acked: a, stored: t, duplicates: dups };
  if (a === t) return { kind: "equal", acked: a, stored: t, duplicates: dups };
  const gap = Math.abs(a - t);
  const allowed = Math.ceil((Math.max(a, t) / windowSeconds) * SCRAPE_SECONDS);
  return gap <= allowed ? { kind: "in-step", acked: a, stored: t, duplicates: dups, gap } : { kind: "differs", acked: a, stored: t, duplicates: dups };
}
