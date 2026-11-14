// Zone C placeholder. Health, metrics, migrations and an Alertmanager webhook that logs
// alerts. The analyst (/insights/ask), narrator, briefing, Storage Lab and anomalies are
// zone C's backlog. The Anthropic SDK is installed but not called yet.
import Fastify from "fastify";
import pg from "pg";
import { Registry, collectDefaultMetrics, Counter } from "prom-client";
import { migrate } from "./migrate.js";
import { storageLabRoutes } from "./storageLab/routes.js";
import { RunStore } from "./storageLab/store.js";

const port = Number(process.env.PORT ?? 8070);
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const alertsReceived = new Counter({
  name: "insights_alerts_received_total",
  help: "Alertmanager notifications received",
  labelNames: ["status"],
  registers: [registry],
});

const pool = new pg.Pool({ connectionString: process.env.INSIGHTS_DATABASE_URL, max: 5 });

const app = Fastify({ logger: true });

app.get("/insights/health", async () => ({
  status: "up",
  service: "insights",
  version: "0.1.0",
  ai: process.env.ANTHROPIC_API_KEY ? "configured" : "missing-key",
}));
app.get("/insights/metrics", async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

interface AlertmanagerWebhook {
  status?: "firing" | "resolved";
  alerts?: { labels?: Record<string, string> }[];
}
app.post<{ Body: AlertmanagerWebhook }>("/insights/alerts", async (req, reply) => {
  alertsReceived.inc({ status: req.body.status ?? "unknown" });
  req.log.info({ alerts: req.body.alerts?.map((a) => a.labels?.alertname) }, "alert received");
  return reply.code(202).send();
});

const labStore = new RunStore(pool);
storageLabRoutes(app, labStore, process.env.FILEGRID_API_URL ?? "http://filegrid-api:8080", process.env.JWT_SECRET ?? "");

try {
  const applied = await migrate(pool, new URL("../migrations", import.meta.url).pathname);
  app.log.info({ applied }, "insights migrations done");
  await labStore.failStale();
} catch (err) {
  // Keep serving health so the stack still comes up; the error is visible in logs.
  app.log.error({ err }, "insights migrations failed");
}

await app.listen({ host: "0.0.0.0", port });
