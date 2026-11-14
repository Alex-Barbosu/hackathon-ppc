export interface PromSample { labels: Record<string, string>; value: number }
export interface PromSummary { labels: Record<string, string>; last: number; min: number; max: number; avg: number; points: number }

/** What the analyst, narrator and briefing may ask of Prometheus; tests supply a fake. */
export interface PromLike {
  instant(promql: string): Promise<PromSample[]>;
  range(promql: string, minutes: number): Promise<PromSummary[]>;
}

const MAX_SERIES = 20;
export const MAX_PROMQL = 500;

interface Reply { status: string; error?: string; data?: { result: Array<{ metric: Record<string, string>; value?: [number, string]; values?: Array<[number, string]> }> } }

export class PromClient implements PromLike {
  constructor(private readonly base: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async get(path: string, params: Record<string, string>): Promise<NonNullable<Reply["data"]>["result"]> {
    const res = await this.fetchImpl(`${this.base}/api/v1/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json()) as Reply;
    if (body.status !== "success" || !body.data) throw new Error(`Prometheus: ${(body.error ?? res.statusText).slice(0, 160)}`);
    return body.data.result.slice(0, MAX_SERIES);
  }

  async instant(promql: string): Promise<PromSample[]> {
    if (!promql.trim() || promql.length > MAX_PROMQL) throw new Error(`PromQL must be 1..${MAX_PROMQL} characters`);
    const rows = await this.get("query", { query: promql });
    // NaN is "no traffic in the window"; it is dropped, not reported as a zero.
    return rows.flatMap((r) => {
      const v = Number(r.value?.[1]);
      return Number.isFinite(v) ? [{ labels: r.metric, value: v }] : [];
    });
  }

  /** A range query is summarised (last/min/max/avg), so a 6 hour window costs a few tokens, not thousands. */
  async range(promql: string, minutes: number): Promise<PromSummary[]> {
    if (!promql.trim() || promql.length > MAX_PROMQL) throw new Error(`PromQL must be 1..${MAX_PROMQL} characters`);
    const m = Math.min(Math.max(Math.floor(minutes), 1), 1440);
    const end = Math.floor(Date.now() / 1000);
    const step = Math.max(15, Math.ceil((m * 60) / 200));
    const rows = await this.get("query_range", { query: promql, start: String(end - m * 60), end: String(end), step: String(step) });
    return rows.flatMap((r) => {
      const v = (r.values ?? []).map(([, x]) => Number(x)).filter(Number.isFinite);
      if (!v.length) return [];
      return [{ labels: r.metric, last: v[v.length - 1] ?? 0, min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, points: v.length }];
    });
  }
}
