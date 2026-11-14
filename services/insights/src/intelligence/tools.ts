import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "./db.js";
import type { KnowledgeSearch } from "./knowledge.js";
import { MAX_PROMQL, type PromLike } from "./prom.js";
import { queryView, VIEW_NAMES, type ViewName } from "./views.js";

export interface Source { label: string; query: string; value: string }
export interface ToolResult { text: string; sources: Source[]; isError?: boolean }
export interface LabSummary { recommendation: Array<{ category: string; storage: string; reason: string }>; cells: unknown[] }
export interface ToolContext { db: Db; prom: PromLike; knowledge: KnowledgeSearch; lab: () => Promise<LabSummary | null> }

const MAX_TEXT = 3500;
const MAX_CHIPS = 10;

/** Tool output is capped before it enters the context: a runaway query must not become a runaway bill. */
export const capText = (s: string): string => (s.length <= MAX_TEXT ? s : `${s.slice(0, MAX_TEXT)}\n[truncated: ask a narrower question]`);

const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3));
const tag = (l: Record<string, string>) => Object.entries(l).filter(([k]) => !["instance", "job", "__name__"].includes(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "total";
const err = (m: string): ToolResult => ({ text: `Error: ${m}`, sources: [], isError: true });

// The order and wording of these definitions are part of the cached prefix: change them rarely.
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "query_prometheus",
    description: "Run one PromQL query against FileGrid's metrics. Without `minutes` it returns the current value per series; with `minutes` (1 to 1440) it returns last, min, max and average over that window. At most 20 series come back.",
    input_schema: {
      type: "object",
      properties: {
        promql: { type: "string", description: `A PromQL expression, at most ${MAX_PROMQL} characters. Prefer aggregating with sum by (category) or histogram_quantile.` },
        minutes: { type: "integer", description: "Window in minutes for last/min/max/avg. Omit for the current value." },
      },
      required: ["promql"],
    },
  },
  {
    name: "query_view",
    description: "Read an aggregate view of the database. files_daily: files and bytes per day, category and storage. meter_anomalies: unusual meters (drop, spike, stuck, voltage sag) with a score. outage_hotspots: outage records per county (or region when no county was given), with the latest fault time and the top stations named by the recordings. alert_history: which alerts fired and how often. Returns at most 50 rows.",
    input_schema: {
      type: "object",
      properties: {
        view: { type: "string", enum: [...VIEW_NAMES] },
        region: { type: "string", enum: ["muntenia", "banat", "dobrogea"] },
        category: { type: "string", enum: ["meter", "outage", "document", "video"] },
        storage: { type: "string", enum: ["db", "s3", "ftp"] },
        days: { type: "integer", description: "Look back this many days (1 to 60), default 7." },
        limit: { type: "integer", description: "Rows to return (1 to 50), default 20." },
      },
      required: ["view"],
    },
  },
  {
    name: "get_storage_lab_result",
    description: "The latest Storage Lab benchmark: per category and storage the write and read latency, throughput and errors, and the recommended storage per category with its reasons.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_knowledge",
    description: "Search the background notes on grid operations and reliability practice. May return nothing; say so rather than guessing.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    cache_control: { type: "ephemeral" },
  },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optInt = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

async function prometheus(ctx: ToolContext, a: Record<string, unknown>): Promise<ToolResult> {
  const q = optStr(a.promql)?.trim();
  if (!q) return err("promql is required");
  if (q.length > MAX_PROMQL) return err(`promql is longer than ${MAX_PROMQL} characters`);
  const minutes = optInt(a.minutes);
  if (minutes !== undefined) {
    const rows = await ctx.prom.range(q, minutes);
    const sources = rows.slice(0, MAX_CHIPS).map((r) => ({ label: `${tag(r.labels)} over ${Math.min(Math.max(minutes, 1), 1440)} min`, query: q, value: `last ${num(r.last)}, avg ${num(r.avg)}, max ${num(r.max)}` }));
    return { text: capText(JSON.stringify(rows.map((r) => ({ series: tag(r.labels), last: num(r.last), min: num(r.min), max: num(r.max), avg: num(r.avg) })))), sources };
  }
  const rows = await ctx.prom.instant(q);
  return { text: capText(JSON.stringify(rows.map((r) => ({ series: tag(r.labels), value: num(r.value) })))), sources: rows.slice(0, MAX_CHIPS).map((r) => ({ label: tag(r.labels), query: q, value: num(r.value) })) };
}

async function view(ctx: ToolContext, a: Record<string, unknown>): Promise<ToolResult> {
  const v = optStr(a.view);
  if (!v || !(VIEW_NAMES as readonly string[]).includes(v)) return err(`view must be one of ${VIEW_NAMES.join(", ")}`);
  const rows = await queryView(ctx.db, v as ViewName, { region: optStr(a.region), category: optStr(a.category), storage: optStr(a.storage), days: optInt(a.days), limit: optInt(a.limit) });
  const compact = (r: Record<string, unknown>) => Object.entries(r).filter(([k]) => k !== "explanation").map(([k, x]) => `${k}=${x instanceof Date ? x.toISOString().slice(0, 16) : String(x)}`).join(" ").slice(0, 140);
  return { text: capText(JSON.stringify(rows)), sources: rows.slice(0, MAX_CHIPS).map((r, i) => ({ label: `${v} row ${i + 1}`, query: `view:${v}`, value: compact(r) })) };
}

export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  if (!isObj(input)) return err("tool input must be an object");
  try {
    switch (name) {
      case "query_prometheus": return await prometheus(ctx, input);
      case "query_view": return await view(ctx, input);
      case "get_storage_lab_result": {
        const lab = await ctx.lab();
        if (!lab) return { text: "No Storage Lab benchmark has been run yet.", sources: [] };
        return { text: capText(JSON.stringify(lab)), sources: lab.recommendation.map((r) => ({ label: `${r.category}: recommended storage`, query: "storage lab, latest run", value: r.storage })) };
      }
      case "search_knowledge": {
        const hits = ctx.knowledge.search(optStr(input.query) ?? "", 3);
        return { text: hits.length ? capText(JSON.stringify(hits)) : "No background notes are available for this question.", sources: hits.map((h) => ({ label: h.title, query: "knowledge", value: h.id })) };
      }
      default: return err(`unknown tool ${name.slice(0, 40)}`);
    }
  } catch (e) {
    // Only a short message goes back to the model; the cause may be a bad query, which it can fix.
    return err(e instanceof Error ? e.message.slice(0, 200) : "tool failed");
  }
}
