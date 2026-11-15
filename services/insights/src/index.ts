// Zone C. Health, metrics, migrations, Storage Lab and the intelligence layer (alert narrator,
// briefing, anomalies, hotspots, the Claude analyst); see src/intelligence.
import Fastify from "fastify";
import pg from "pg";
import { Registry, collectDefaultMetrics, Counter } from "prom-client";
import { migrate } from "./migrate.js";
import { registerIntelligence } from "./intelligence/routes.js";
import { aiConfigFromEnv } from "./intelligence/llm.js";
import { knowledgeFromEnv } from "./intelligence/knowledge.js";
import { PromClient } from "./intelligence/prom.js";
import { storageLabRoutes } from "./storageLab/routes.js";
import { RunStore } from "./storageLab/store.js";
import { listenAcks, ntfyFromEnv } from "./intelligence/ntfy.js";
import { Pager, pagerConfigFromEnv } from "./intelligence/pager.js";
import { registerPager } from "./intelligence/pagerRoutes.js";

const port = Number(process.env.PORT ?? 8070);
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const alertsReceived = new Counter({
  name: "insights_alerts_received_total",
  help: "Alertmanager notifications received",
  labelNames: ["status"],
  registers: [registry],
});

const pagesSent = new Counter({ name: "insights_pages_total", help: "Pages sent to an on-call person", labelNames: ["route"], registers: [registry] });
const pagesAcked = new Counter({ name: "insights_page_acks_total", help: "Pages acknowledged", labelNames: ["via"], registers: [registry] });

const pool = new pg.Pool({ connectionString: process.env.INSIGHTS_DATABASE_URL, max: 5 });

const app = Fastify({ logger: true });

app.get("/insights/health", async () => ({
  status: "up",
  service: "insights",
  version: "0.1.0",
  ai: process.env.ANTHROPIC_API_KEY?.trim() ? "configured" : "missing-key",
}));
app.get("/insights/metrics", async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

const labStore = new RunStore(pool);
storageLabRoutes(app, labStore, process.env.FILEGRID_API_URL ?? "http://filegrid-api:8080", process.env.JWT_SECRET ?? "");
registerIntelligence(app, {
  db: pool, secret: process.env.JWT_SECRET ?? "", ai: aiConfigFromEnv(process.env), prom: new PromClient(process.env.PROMETHEUS_URL ?? "http://prometheus:9090"),
  knowledge: knowledgeFromEnv(process.env), lab: labStore,
  onAlert: (status) => alertsReceived.inc({ status }), log: (m) => app.log.warn(m),
});

const ntfy = ntfyFromEnv(process.env, (m) => app.log.warn(m));
const pager = new Pager({
  db: pool, cfg: pagerConfigFromEnv(process.env, ntfy), log: (m) => app.log.warn(m),
  onPage: (route) => pagesSent.inc({ route }), onAck: (via) => pagesAcked.inc({ via }),
});
registerPager(app, pager, process.env.JWT_SECRET ?? "");

try {
  const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
  app.log.info({ applied }, "insights migrations done");
  await labStore.failStale();
} catch (err) {
  // Keep serving health so the stack still comes up; the error is visible in logs.
  app.log.error({ err }, "insights migrations failed");
}

await app.listen({ host: "0.0.0.0", port });

// The pager runs after migrations so its table exists. Every 10 s keeps a page within seconds of its hold time.
const stopPager = new AbortController();
const pagerTimer = setInterval(() => void pager.tick(), 10_000);
if (ntfy) void listenAcks(ntfy, (a) => pager.ackFromPhone(a.id, a.token), stopPager.signal, (m) => app.log.warn(m));
app.log.info({ phone: ntfy ? "on" : "off" }, "pager started");
for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => { clearInterval(pagerTimer); stopPager.abort(); void app.close().then(() => process.exit(0)); });
