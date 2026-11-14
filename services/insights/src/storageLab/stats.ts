import type { Latency } from "./types.js";

/** Nearest-rank percentile; with 5 samples p95 and p99 are the slowest sample, which is honest. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

export function latency(ms: readonly number[]): Latency {
  const s = [...ms].sort((a, b) => a - b);
  return { p50Ms: percentile(s, 50), p95Ms: percentile(s, 95), p99Ms: percentile(s, 99) };
}

export const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
