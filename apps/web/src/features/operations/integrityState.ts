export type IntegrityState =
  | { kind: "no-api"; sent: number | null }
  | { kind: "equal"; sent: number; stored: number; duplicates: number }
  | { kind: "differs"; sent: number | null; stored: number; duplicates: number };

/**
 * "Stored" is only ever the API's own accepted counter. The simulator's acks are the simulator's
 * word, not proof the API stored anything, so they are never substituted: if the API has
 * reported nothing, the card says so instead of showing a comforting number.
 *
 * `stored` is undefined when the series does not exist (the API never counted a reading) and a
 * number, zero included, once it does.
 */
export function integrityState(sent: number | null, stored: number | undefined, duplicates: number | undefined): IntegrityState {
  if (stored === undefined || !Number.isFinite(stored)) return { kind: "no-api", sent };
  const dups = Math.round(duplicates ?? 0);
  const s = sent === null ? null : Math.round(sent);
  const t = Math.round(stored);
  return s !== null && s === t ? { kind: "equal", sent: s, stored: t, duplicates: dups } : { kind: "differs", sent: s, stored: t, duplicates: dups };
}
