import { getAlert, saveNarration, saveNarrationError, type StoredAlert } from "./alertStore.js";
import type { Db } from "./db.js";
import { BudgetExceeded, textOf, type Llm } from "./llm.js";
import { alertFacts, isCategory, isStorage } from "./privacy.js";
import type { PromLike } from "./prom.js";

export const NARRATOR_SYSTEM = `You are the incident narrator for FileGrid, the file platform of an electricity distribution company.
An operator in a control room will read your note while an alert is firing.
Write exactly two plain sentences. The first says what business guarantee is at risk and for whom. The second gives the most probable cause and one next step.
Use only the facts you are given. Do not invent numbers, names or causes that the facts do not support; if the cause is unclear, say what to check first.
No headings, no lists, no markdown, no emoji.`;

const MAX_CHARS = 420;

/** Two sentences at most, on one line: the model's formatting is not trusted. */
export function twoSentences(text: string): string {
  const flat = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  return (flat.match(/[^.!?]+[.!?]+(\s|$)/g)?.slice(0, 2).join("").trim() || flat).slice(0, MAX_CHARS);
}

const secs = (v: number) => (v >= 1 ? `${v.toFixed(2)} s` : `${(v * 1000).toFixed(0)} ms`);

/** Metric facts about the alert's category and storage; numbers only. Label values are validated first so
 * nothing from the webhook is ever spliced into PromQL unchecked. */
export async function relatedMetrics(prom: PromLike, labels: Record<string, string>): Promise<Array<{ label: string; value: string }>> {
  const out: Array<{ label: string; value: string }> = [];
  const ask = async (label: string, q: string, fmt: (n: number) => string) => {
    try {
      const v = (await prom.instant(q))[0]?.value;
      if (v !== undefined) out.push({ label, value: fmt(v) });
    } catch { /* a missing metric is not a reason to skip the narration */ }
  };
  if (isCategory(labels.category)) {
    const c = labels.category;
    await ask(`${c} write p95, last 5 min`, `histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="${c}",op="write"}[5m])))`, secs);
    await ask(`${c} error rate, last 5 min`, `sum(rate(filegrid_ops_total{category="${c}",outcome="error"}[5m])) / clamp_min(sum(rate(filegrid_ops_total{category="${c}"}[5m])), 1e-9)`, (n) => `${(n * 100).toFixed(1)}%`);
    await ask(`${c} queue depth`, `sum(filegrid_queue_depth{category="${c}"})`, (n) => `${Math.round(n)} items`);
    await ask(`${c} items in spool`, `sum(filegrid_spool_pending{category="${c}"})`, (n) => `${Math.round(n)} items`);
  }
  if (isStorage(labels.storage)) {
    await ask(`${labels.storage} reachable (1 = yes)`, `min(filegrid_storage_up{storage="${labels.storage}"})`, (n) => String(Math.round(n)));
    await ask(`${labels.storage} circuit open (1 = yes)`, `max(filegrid_circuit_open{storage="${labels.storage}"})`, (n) => String(Math.round(n)));
  }
  return out;
}

export interface NarratorDeps { db: Db; llm: Llm | null; model: string; prom: PromLike }

/** Writes and stores the narration for one alert. Failure leaves the alert's own summary as the text. */
export async function narrateAlert(d: NarratorDeps, alert: StoredAlert): Promise<string | null> {
  if (!d.llm) { await saveNarrationError(d.db, alert.id, "no_key"); return null; }
  const facts = alertFacts({ alertname: alert.alertname, status: alert.status, labels: alert.labels, annotations: alert.annotations, startsAt: alert.startsAt });
  const metrics = await relatedMetrics(d.prom, facts.labels);
  try {
    const res = await d.llm.create({
      model: d.model,
      max_tokens: 300,
      output_config: { effort: "low" },
      system: [{ type: "text", text: NARRATOR_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify({ alert: facts, metrics }) }],
    });
    const text = res.stop_reason === "refusal" ? "" : twoSentences(textOf(res));
    if (!text) { await saveNarrationError(d.db, alert.id, "empty"); return null; }
    await saveNarration(d.db, alert.id, text, d.model);
    return text;
  } catch (e) {
    await saveNarrationError(d.db, alert.id, e instanceof BudgetExceeded ? "budget" : "unavailable");
    return null;
  }
}

/** Narrations run in the background, two at a time, once per alert id: the webhook answers at once. */
export class NarrationQueue {
  private readonly pending: number[] = [];
  private readonly seen = new Set<number>();
  private running = 0;
  constructor(private readonly deps: NarratorDeps, private readonly concurrency = 2, private readonly log: (m: string) => void = () => {}) {}

  enqueue(ids: number[]): void {
    for (const id of ids) if (!this.seen.has(id)) { this.seen.add(id); this.pending.push(id); }
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending.length) {
      const id = this.pending.shift() as number;
      this.running++;
      void getAlert(this.deps.db, id)
        .then((a) => (a ? narrateAlert(this.deps, a) : null))
        .catch((e: unknown) => this.log(`narration failed for alert ${id}: ${e instanceof Error ? e.name : "error"}`))
        .finally(() => { this.running--; this.seen.delete(id); this.pump(); });
    }
  }
}
