// Seeded randomness. Every reading is rebuilt from its identity (meterId, periodStart, seq)
// with this PRNG, so a retry or a replay after a restart produces the exact same bytes
// without keeping thousands of bodies in memory while the target is down.

export type Rng = () => number;

/** FNV-1a: cheap, well-spread 32-bit hash of a string seed. */
export function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast and good enough for synthetic telemetry (not for crypto). */
export function rng(seed: string): Rng {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller). */
export function gaussian(r: Rng): number {
  const u = 1 - r(); // (0, 1], keeps log finite
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pickWeighted<T extends { weight: number }>(r: Rng, items: readonly T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = r() * total;
  for (const item of items) {
    x -= item.weight;
    if (x < 0) return item;
  }
  const last = items[items.length - 1];
  if (!last) throw new Error("pickWeighted: empty list");
  return last;
}
