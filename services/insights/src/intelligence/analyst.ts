import type Anthropic from "@anthropic-ai/sdk";
import type { Briefing } from "./briefing.js";
import { textOf, type Llm } from "./llm.js";
import { scrub } from "./privacy.js";
import { runTool, TOOL_DEFS, type Source, type ToolContext } from "./tools.js";

export interface AnalystEvent {
  type: "thinking" | "tool_call" | "text" | "sources" | "done" | "error";
  text?: string; tool?: string; sources?: Source[];
}

export const ANALYST_SYSTEM = `You are the grid analyst for FileGrid, the single entry point for operational files at Rețele Electrice România (PPC group). You answer questions for engineers and decision makers using only the tools you are given.

How to answer
- Numbers first, then what they mean, then a recommendation, then your confidence (high, medium or low) and why.
- Every number you state must come from a tool result in this conversation. Copy it exactly with its unit. If you do not have a number, say so; never estimate.
- Be concise: a short paragraph or a few short bullets. No headings, no emoji.
- If a tool returns nothing or an error, say what is missing and what would fix it (for example "no benchmark has been run yet").
- Never ask for, repeat or reason about file contents, file names, customer names or ID numbers. If asked for them, explain that the analyst only sees aggregate and technical data.

Categories: meter (smart meter readings, 1-50 KB, never lost or duplicated), outage (substation records, 1-10 MB, available to dispatch immediately), document (customer connection documents, personal data, encrypted and audited), video (drone inspections, 100 MB and up, resumable). Storages: db (PostgreSQL), s3 (SeaweedFS), ftp (FTPS).

Metrics you can query with query_prometheus (Prometheus names):
- filegrid_op_duration_seconds_bucket / _count / _sum: histogram of write, read and verify time, labels category, storage, op, outcome. p95 per category: histogram_quantile(0.95, sum by (le, category) (rate(filegrid_op_duration_seconds_bucket{op="write"}[5m]))).
- filegrid_ops_total: counter, labels category, storage, op, outcome (ok, error, fallback). Throughput: sum by (category) (rate(filegrid_ops_total[5m])). Error rate: divide the error rate by the total rate.
- filegrid_bytes_total: counter, labels category, storage, direction (in, out).
- filegrid_queue_depth{category}: items waiting in each category's queue. filegrid_spool_pending{category}: items parked in the spool.
- filegrid_meter_readings_total{result}: accepted, duplicate, rejected. meter_sim_sent_total, meter_sim_acked_total, meter_sim_retries_total: the simulator's counters. meter_sim_rate: configured readings per second.
- filegrid_storage_up{storage}, filegrid_circuit_open{storage}: 1 or 0. filegrid_integrity_failures_total{category, storage}.
For a "storm", compare a category's throughput and p95 during the storm with the hour before, and check whether other categories' p95 moved. For counters over a period use increase(metric[30m]), which handles restarts.`;

export interface Conversations {
  history(id: string | undefined): Anthropic.MessageParam[];
  remember(id: string | undefined, question: string, answer: string): void;
}

/** A few recent exchanges per conversation, in memory: enough for a follow-up question, nothing durable. */
export class MemoryConversations implements Conversations {
  private readonly m = new Map<string, { at: number; turns: Anthropic.MessageParam[] }>();
  constructor(private readonly ttlMs = 30 * 60_000, private readonly maxConversations = 50, private readonly now: () => number = Date.now) {}

  history(id: string | undefined): Anthropic.MessageParam[] {
    const c = id ? this.m.get(id) : undefined;
    return c && this.now() - c.at < this.ttlMs ? [...c.turns] : [];
  }

  remember(id: string | undefined, question: string, answer: string): void {
    if (!id || !answer) return;
    const turns = [...this.history(id), { role: "user" as const, content: question }, { role: "assistant" as const, content: answer }].slice(-6);
    this.m.delete(id);
    this.m.set(id, { at: this.now(), turns });
    while (this.m.size > this.maxConversations) this.m.delete(this.m.keys().next().value as string);
  }
}

export interface AnalystDeps {
  llm: Llm | null; model: string; ctx: ToolContext; conversations: Conversations; fallback: () => Promise<Briefing | null>;
}

const MAX_ITERATIONS = 6;
const MAX_QUESTION = 1000;
const SYSTEM_BLOCKS: Anthropic.TextBlockParam[] = [{ type: "text", text: ANALYST_SYSTEM, cache_control: { type: "ephemeral" } }];

const callText = (name: string, input: unknown): string => {
  const i = (input ?? {}) as Record<string, unknown>;
  return name === "query_prometheus" ? `Querying Prometheus: ${String(i.promql ?? "").slice(0, 120)}` : name === "query_view" ? `Reading view ${String(i.view ?? "")}` : name === "get_storage_lab_result" ? "Reading the Storage Lab result" : "Searching the background notes";
};

async function fallbackAnswer(d: AnalystDeps, emit: (e: AnalystEvent) => void, why: string): Promise<void> {
  emit({ type: "error", text: why });
  const b = await d.fallback().catch(() => null);
  if (!b) { emit({ type: "text", text: "No written briefing is available yet either. The live numbers are on the Operations page." }); return; }
  emit({ type: "text", text: `Here is the most recent written briefing instead (generated ${b.generatedAt.slice(0, 16).replace("T", " ")} UTC).\n\n${b.summary}\n\n${b.sections.map((s) => `${s.title}: ${s.body}`).join("\n\n")}` });
  emit({ type: "sources", sources: b.sections.flatMap((s) => s.metrics).slice(0, 12).map((m) => ({ label: m.label, query: "cached briefing", value: m.value })) });
}

/**
 * The Claude analyst: a bounded tool loop that streams its text. Any failure (no key, budget, API error,
 * refusal) ends in the cached briefing, so a question never meets an empty box during a demo.
 */
export async function runAnalyst(d: AnalystDeps, rawQuestion: string, conversationId: string | undefined, emit: (e: AnalystEvent) => void, cancelled: () => boolean = () => false): Promise<void> {
  // Rule 8: nothing personal may reach the model, even if a user types it into the question.
  const question = scrub(rawQuestion.trim().slice(0, MAX_QUESTION));
  if (!d.llm) { await fallbackAnswer(d, emit, "The AI analyst is not configured on this server."); emit({ type: "done" }); return; }
  const messages: Anthropic.MessageParam[] = [...d.conversations.history(conversationId), { role: "user", content: question }];
  const chips: Source[] = [];
  let answer = "";
  try {
    emit({ type: "thinking", text: "Reading the question" });
    for (let i = 0; i < MAX_ITERATIONS && !cancelled(); i++) {
      let turnText = "";
      const res = await d.llm.stream(
        { model: d.model, max_tokens: 1500, output_config: { effort: "low" }, system: SYSTEM_BLOCKS, tools: TOOL_DEFS, messages },
        (t) => { turnText += t; emit({ type: "text", text: t }); },
      );
      if (res.stop_reason === "refusal") throw new Error("refusal");
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) { answer = textOf(res) || turnText; break; }
      messages.push({ role: "assistant", content: res.content });
      for (const u of uses) emit({ type: "tool_call", tool: u.name, text: callText(u.name, u.input) });
      const results = await Promise.all(uses.map((u) => runTool(d.ctx, u.name, u.input)));
      const fresh = results.flatMap((r) => r.sources);
      chips.push(...fresh);
      if (fresh.length) emit({ type: "sources", sources: fresh });
      messages.push({ role: "user", content: uses.map((u, k) => ({ type: "tool_result" as const, tool_use_id: u.id, content: results[k]?.text ?? "", ...(results[k]?.isError ? { is_error: true } : {}) })) });
      if (i === MAX_ITERATIONS - 1) emit({ type: "text", text: "\n\nI stopped after several lookups without a final answer; ask a narrower question." });
    }
    d.conversations.remember(conversationId, question, answer);
    emit({ type: "done" });
  } catch (e) {
    await fallbackAnswer(d, emit, e instanceof Error && e.name === "BudgetExceeded" ? "The AI call budget for this hour is used up." : "The AI analyst could not answer just now.");
    emit({ type: "done" });
  }
}
