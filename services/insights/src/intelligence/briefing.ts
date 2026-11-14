import type { Db } from "./db.js";
import { iso, str } from "./db.js";
import { textOf, type Llm } from "./llm.js";
import type { PromLike } from "./prom.js";
import { listAnomalies, listHotspots } from "./views.js";

export interface Fact { label: string; value: string }
export interface FactGroup { title: string; facts: Fact[]; notes: string[] }
export interface Briefing {
  generatedAt: string; cached?: boolean; summary: string;
  sections: Array<{ title: string; body: string; metrics: Fact[] }>;
}

export const TITLES = ["Which storage fits each category and why", "Peak versus normal", "What the grid data says"] as const;
const CATS = ["meter", "outage", "document", "video"] as const;
const CAT_NAME: Record<string, string> = { meter: "meters", outage: "outage records", document: "documents", video: "video" };
const STORE_NAME: Record<string, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS" };
const TTL_MS = 30 * 60_000;
const MAX_MINUTES = 1440;

const f1 = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
const ms = (s: number) => `${f1(s * 1000)} ms`;

export interface LabLike { latestRun(): Promise<{ recommendation?: Array<{ category: string; storage: string; reason: string; evidence?: Fact[] }> } | null> }
export interface BriefingDeps { db: Db; prom: PromLike; lab: LabLike; llm: Llm | null; model: string; now?: () => Date }

/** Everything the briefing may say, gathered first, so the model only writes and never fetches. */
export async function gatherFacts(d: BriefingDeps, from: Date, to: Date): Promise<FactGroup[]> {
  const minutes = Math.min(Math.max(Math.round((to.getTime() - from.getTime()) / 60_000), 1), MAX_MINUTES);
  const period = `${from.toISOString().slice(0, 16)}Z to ${to.toISOString().slice(0, 16)}Z`;
  const safe = async <T>(p: Promise<T>, empty: T): Promise<T> => p.catch(() => empty);

  const storage: FactGroup = { title: TITLES[0], facts: [], notes: [] };
  const run = await safe(d.lab.latestRun(), null);
  for (const r of run?.recommendation ?? []) {
    storage.facts.push({ label: `${CAT_NAME[r.category] ?? r.category}: recommended storage`, value: STORE_NAME[r.storage] ?? r.storage });
    storage.notes.push(`${CAT_NAME[r.category] ?? r.category}: ${r.reason}`);
    for (const e of r.evidence ?? []) storage.facts.push({ label: `${CAT_NAME[r.category] ?? r.category} ${e.label}`, value: e.value });
  }
  if (!run) storage.notes.push("No Storage Lab benchmark has been run yet.");

  const traffic: FactGroup = { title: TITLES[1], facts: [], notes: [`Window: ${period}. Normal is the average over the window, peak is the highest minute.`] };
  const [ops, p95, rate] = await Promise.all([
    safe(d.prom.range('sum by (category) (rate(filegrid_ops_total{op="write"}[1m]))', minutes), []),
    safe(d.prom.range('histogram_quantile(0.95, sum by (le, category) (rate(filegrid_op_duration_seconds_bucket{op="write"}[1m])))', minutes), []),
    safe(d.prom.range("max(meter_sim_rate)", minutes), []),
  ]);
  for (const c of CATS) {
    const o = ops.find((s) => s.labels.category === c);
    const p = p95.find((s) => s.labels.category === c);
    if (o) traffic.facts.push({ label: `${CAT_NAME[c]} writes per second, normal`, value: f1(o.avg) }, { label: `${CAT_NAME[c]} writes per second, peak`, value: f1(o.max) });
    if (p) traffic.facts.push({ label: `${CAT_NAME[c]} write p95, normal`, value: ms(p.avg) }, { label: `${CAT_NAME[c]} write p95, peak`, value: ms(p.max) });
  }
  if (rate[0]) traffic.facts.push({ label: "meter simulator rate, peak (readings per second)", value: f1(rate[0].max) });
  if (!traffic.facts.length) traffic.notes.push("Prometheus returned no traffic for this window.");

  const grid: FactGroup = { title: TITLES[2], facts: [], notes: [] };
  const [anomalies, hotspots, integrity, alerts] = await Promise.all([
    safe(listAnomalies(d.db, undefined, 100), []),
    safe(listHotspots(d.db, 20), []),
    safe(d.prom.instant(`sum(increase(filegrid_integrity_failures_total[${minutes}m]))`), []),
    safe(d.db.query("SELECT alertname, count(*)::int AS times FROM insights.alerts WHERE starts_at >= $1 AND starts_at <= $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5", [from.toISOString(), to.toISOString()]).then((r) => r.rows), []),
  ]);
  const byKind = new Map<string, number>();
  for (const a of anomalies) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  for (const [k, n] of byKind) grid.facts.push({ label: `meter anomalies: ${k.replace("_", " ")}`, value: String(n) });
  if (!anomalies.length) grid.notes.push("No meter anomalies were found. Parsed meter intervals may not be stored yet, so the baselines cannot be built.");
  const top = hotspots[0];
  if (top) grid.facts.push({ label: `outage records, ${top.county === "Not recorded" ? `region ${top.region} (county not recorded)` : top.county}`, value: String(top.outages) });
  const station = top?.stations[0];
  if (top && station) grid.facts.push({ label: `busiest station in ${top.county === "Not recorded" ? top.region : top.county}: ${station.station}`, value: `${station.outages} outage records` });
  grid.facts.push({ label: "integrity failures in the window", value: String(Math.round(integrity[0]?.value ?? 0)) });
  for (const a of alerts) grid.facts.push({ label: `alert fired: ${str(a.alertname)}`, value: Number(a.times) === 1 ? "1 time" : `${str(a.times)} times` });
  return [storage, traffic, grid];
}

/** The same shape without a model: plain statements of the gathered facts. Used when the AI is off or failing. */
export function deterministicBriefing(groups: FactGroup[], now: Date): Briefing {
  return {
    generatedAt: now.toISOString(),
    summary: "Written directly from the measurements, without AI. The numbers below are exact; the explanations are the Storage Lab's own reasons.",
    sections: groups.map((g) => ({
      title: g.title,
      body: g.notes.length ? g.notes.join("\n\n") : "No data for this section yet.",
      metrics: g.facts.slice(0, 8),
    })),
  };
}

export const BRIEFING_SYSTEM = `You write the written briefing for Section 5 of a hackathon submission, for a decision maker at an electricity distributor (Rețele Electrice România).
You are given measured facts in three groups. Write exactly three sections with the titles given, plus a summary of at most three sentences that leads with the decision a manager should take.
Rules: use only the facts; copy every number exactly as written; never estimate or round differently. Each section body is at most four plain sentences and ends, where the facts allow, with a recommendation.
In "metrics", list the facts you relied on, copying each fact's label and value exactly. Say clearly when data is missing instead of guessing. No file names, no personal data, no markdown.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" }, body: { type: "string" },
          metrics: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false } },
        },
        required: ["title", "body", "metrics"], additionalProperties: false,
      },
    },
  },
  required: ["summary", "sections"], additionalProperties: false,
} as const;

/** Keeps only metrics that are exact copies of a gathered fact, so every chip on the page is verifiable. */
export function groundBriefing(raw: unknown, groups: FactGroup[], now: Date): Briefing | null {
  const known = new Set(groups.flatMap((g) => g.facts.map((x) => `${x.label}|${x.value}`)));
  const b = raw as { summary?: unknown; sections?: unknown };
  if (typeof b?.summary !== "string" || !Array.isArray(b.sections)) return null;
  const sections = (b.sections as Array<{ title?: unknown; body?: unknown; metrics?: unknown }>).flatMap((s) =>
    typeof s.title === "string" && typeof s.body === "string"
      ? [{ title: s.title, body: s.body, metrics: ((Array.isArray(s.metrics) ? s.metrics : []) as Fact[]).filter((m) => known.has(`${m.label}|${m.value}`)) }]
      : [],
  );
  return sections.length ? { generatedAt: now.toISOString(), summary: b.summary.trim(), sections } : null;
}

async function writeWithAi(d: BriefingDeps, groups: FactGroup[], now: Date): Promise<Briefing | null> {
  if (!d.llm) return null;
  const res = await d.llm.create({
    model: d.model,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    system: [{ type: "text", text: BRIEFING_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify({ requiredTitles: TITLES, groups }) }],
  });
  if (res.stop_reason === "refusal") return null;
  try { return groundBriefing(JSON.parse(textOf(res)), groups, now); } catch { return null; }
}

const bucket = (d: Date) => Math.floor(d.getTime() / 3_600_000);

export class BriefingService {
  private readonly inflight = new Map<string, Promise<Briefing>>();
  constructor(private readonly d: BriefingDeps) {}
  private now() { return this.d.now?.() ?? new Date(); }

  private async cached(key: string | null): Promise<{ body: Briefing; at: Date; ai: boolean } | null> {
    const sql = key ? "SELECT body, generated_at, ai FROM insights.briefings WHERE key = $1" : "SELECT body, generated_at, ai FROM insights.briefings WHERE ai ORDER BY generated_at DESC LIMIT 1";
    const { rows } = await this.d.db.query(sql, key ? [key] : []);
    const r = rows[0];
    return r ? { body: r.body as Briefing, at: new Date(iso(r.generated_at)), ai: r.ai === true } : null;
  }

  /** The newest written briefing of any period, for the analyst's fallback. */
  async latest(): Promise<Briefing | null> {
    const c = await this.cached(null).catch(() => null);
    return c ? { ...c.body, cached: true } : null;
  }

  get(from: Date, to: Date): Promise<Briefing> {
    const key = `${bucket(from)}-${bucket(to)}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.build(key, from, to).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async build(key: string, from: Date, to: Date): Promise<Briefing> {
    const now = this.now();
    const hit = await this.cached(key).catch(() => null);
    if (hit?.ai && now.getTime() - hit.at.getTime() < TTL_MS) return { ...hit.body, cached: true };
    const groups = await gatherFacts(this.d, from, to);
    try {
      const fresh = await writeWithAi(this.d, groups, now);
      if (fresh) {
        await this.d.db.query(
          "INSERT INTO insights.briefings (key, period_from, period_to, generated_at, model, ai, body) VALUES ($1,$2,$3,now(),$4,true,$5) ON CONFLICT (key) DO UPDATE SET generated_at=now(), model=$4, ai=true, body=$5",
          [key, from.toISOString(), to.toISOString(), this.d.model, JSON.stringify(fresh)]);
        return { ...fresh, cached: false };
      }
    } catch {
      // Budget used up or an API error: fall through to the last written briefing, then the plain one.
    }
    const stale = hit?.ai ? hit : await this.cached(null).catch(() => null);
    if (stale?.ai) return { ...stale.body, cached: true };
    return { ...deterministicBriefing(groups, now), cached: false };
  }
}
