import { useQuery } from "@tanstack/react-query";
import { PROM_BASE } from "./prom";

interface Sample { metric: Record<string, string>; value: [number, string] }
interface Series { metric: Record<string, string>; values: Array<[number, string]> }
interface PromResponse<T> { status: string; data: { result: T[] } }

async function get<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T[]> {
  const res = await fetch(`${PROM_BASE}/${path}?${new URLSearchParams(params)}`, { signal });
  if (!res.ok) throw new Error(`Prometheus answered ${res.status}`);
  const body = (await res.json()) as PromResponse<T>;
  return body.data.result;
}

// NaN means "no traffic in the window"; treating it as a number would draw a false zero.
export const toNumber = (v: string): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Instant query, refreshed every 5 s. Returns one value per label value (or "" key when unlabelled). */
export function usePromQuery(promql: string, label = "category") {
  return useQuery({
    queryKey: ["prom", promql],
    refetchInterval: 5000,
    queryFn: async ({ signal }) => {
      const rows = await get<Sample>("query", { query: promql }, signal);
      const out = new Map<string, number | null>();
      for (const r of rows) out.set(r.metric[label] ?? "", toNumber(r.value[1]));
      return out;
    },
  });
}

export interface Point { t: number; v: number | null }

/** Range query over the last `minutes`, one point every `stepSec`, first series only. */
export function usePromRange(promql: string, minutes = 10, stepSec = 5) {
  return useQuery({
    queryKey: ["prom-range", promql, minutes],
    refetchInterval: 5000,
    queryFn: async ({ signal }): Promise<Point[]> => {
      const end = Math.floor(Date.now() / 1000);
      const rows = await get<Series>(
        "query_range",
        { query: promql, start: String(end - minutes * 60), end: String(end), step: String(stepSec) },
        signal,
      );
      return (rows[0]?.values ?? []).map(([t, v]) => ({ t: t * 1000, v: toNumber(v) }));
    },
  });
}
