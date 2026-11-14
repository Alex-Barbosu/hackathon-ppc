import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MemoryConversations, runAnalyst, type AnalystEvent } from "./analyst.js";
import { listIncidents, parseWebhook, upsertAlerts } from "./alertStore.js";
import { BriefingService } from "./briefing.js";
import type { Db } from "./db.js";
import { bearer, verifyJwt, type Claims } from "./jwt.js";
import type { AiConfig } from "./llm.js";
import type { KnowledgeSearch } from "./knowledge.js";
import { NarrationQueue } from "./narrator.js";
import type { PromLike } from "./prom.js";
import type { ToolContext } from "./tools.js";
import { listAnomalies, listHotspots } from "./views.js";

export interface LabSource { latest(): Promise<{ recommendation?: Array<{ category: string; storage: string; reason: string; evidence?: Array<{ label: string; value: string }> }>; cells?: Array<{ category: string; storage: string; write?: unknown; read?: unknown; throughputMBps?: number | undefined; errors: number; errorSamples: string[] }> } | null> }

export interface IntelligenceDeps {
  db: Db; secret: string; ai: AiConfig; prom: PromLike; knowledge: KnowledgeSearch; lab: LabSource;
  onAlert?: (status: string) => void; log?: (m: string) => void;
}

/** Alertmanager reaches insights directly; anything that came through Caddy carries forwarding headers. */
export const cameThroughGateway = (h: Record<string, unknown>): boolean => h["x-forwarded-for"] !== undefined || h["x-forwarded-host"] !== undefined;

export function authed(req: FastifyRequest, reply: FastifyReply, secret: string): Claims | null {
  const claims = verifyJwt(bearer(req.headers.authorization), secret);
  if (!claims) void reply.code(401).send({ code: "UNAUTHORIZED", message: "missing or invalid credentials" });
  return claims;
}

const DAY_MS = 86_400_000;
const REGIONS = ["muntenia", "banat", "dobrogea"];

export function registerIntelligence(app: FastifyInstance, d: IntelligenceDeps): void {
  const queue = new NarrationQueue({ db: d.db, llm: d.ai.llm, model: d.ai.narratorModel, prom: d.prom }, 2, d.log);
  const briefings = new BriefingService({ db: d.db, prom: d.prom, lab: { latestRun: () => d.lab.latest() }, llm: d.ai.llm, model: d.ai.analystModel });
  const conversations = new MemoryConversations();
  const ctx: ToolContext = {
    db: d.db, prom: d.prom, knowledge: d.knowledge,
    lab: async () => {
      const run = await d.lab.latest();
      if (!run) return null;
      return {
        recommendation: (run.recommendation ?? []).map((r) => ({ category: r.category, storage: r.storage, reason: r.reason.slice(0, 300) })),
        cells: (run.cells ?? []).map((c) => ({ category: c.category, storage: c.storage, write: c.write, read: c.read, throughputMBps: c.throughputMBps, errors: c.errors, errorSamples: c.errorSamples })),
      };
    },
  };

  app.post("/insights/alerts", async (req, reply) => {
    // The contract says internal network only. The gateway would otherwise let anyone trigger narrations (and spend).
    if (cameThroughGateway(req.headers)) return reply.code(403).send({ code: "FORBIDDEN", message: "the alert webhook is internal only" });
    const alerts = parseWebhook(req.body);
    if (!alerts) return reply.code(400).send({ code: "BAD_REQUEST", message: "not an Alertmanager v4 webhook" });
    d.onAlert?.((req.body as { status?: string }).status ?? "unknown");
    queue.enqueue(await upsertAlerts(d.db, alerts));
    return reply.code(202).send();
  });

  app.get("/insights/incidents", async (req, reply) => (authed(req, reply, d.secret) ? listIncidents(d.db) : reply));

  app.get<{ Querystring: { region?: string } }>("/insights/anomalies", async (req, reply) => {
    if (!authed(req, reply, d.secret)) return reply;
    const region = req.query.region;
    if (region !== undefined && !REGIONS.includes(region)) return reply.code(400).send({ code: "BAD_REQUEST", message: "unknown region" });
    return listAnomalies(d.db, region);
  });

  app.get("/insights/outage-hotspots", async (req, reply) => (authed(req, reply, d.secret) ? listHotspots(d.db) : reply));

  app.get<{ Querystring: { from?: string; to?: string } }>("/insights/briefing", async (req, reply) => {
    if (!authed(req, reply, d.secret)) return reply;
    const to = req.query.to ? new Date(req.query.to) : new Date();
    let from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return reply.code(400).send({ code: "BAD_REQUEST", message: "from and to must be dates, from before to" });
    // Range summaries are capped at 24 h, so a longer ask is answered for the last 24 h of it.
    if (to.getTime() - from.getTime() > DAY_MS) from = new Date(to.getTime() - DAY_MS);
    return briefings.get(from, to);
  });

  app.post<{ Body: { question?: unknown; conversationId?: unknown } }>("/insights/ask", async (req, reply) => {
    if (!authed(req, reply, d.secret)) return reply;
    const { question, conversationId } = req.body ?? {};
    if (typeof question !== "string" || !question.trim()) return reply.code(400).send({ code: "BAD_REQUEST", message: "question is required" });
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    let closed = false;
    raw.on("close", () => { closed = true; });
    const emit = (e: AnalystEvent) => { if (!closed && !raw.writableEnded) raw.write(`data: ${JSON.stringify(e)}\n\n`); };
    await runAnalyst(
      { llm: d.ai.llm, model: d.ai.analystModel, ctx, conversations, fallback: () => briefings.latest() },
      question, typeof conversationId === "string" ? conversationId.slice(0, 64) : undefined, emit, () => closed,
    );
    if (!raw.writableEnded) raw.end();
    return reply;
  });
}
