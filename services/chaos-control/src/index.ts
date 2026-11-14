// Zone B placeholder. Returns a static ChaosState (contracts/openapi.yaml) so the UI can
// wire the chaos panel. Real actions (Docker stop/start via an allowlist, Toxiproxy
// toxics, byte corruption, storms, meter rate) are zone B's backlog.
import Fastify from "fastify";
import { Registry, collectDefaultMetrics } from "prom-client";

const port = Number(process.env.PORT ?? 8090);
const registry = new Registry();
collectDefaultMetrics({ register: registry });

type StorageState = "running" | "stopped";
interface ChaosState {
  storages: Record<"db" | "s3" | "ftp", StorageState>;
  network: unknown[];
  meters: { readingsPerSec: number };
  log: { at: string; action: string }[];
}

const state: ChaosState = {
  storages: { db: "running", s3: "running", ftp: "running" },
  network: [],
  meters: { readingsPerSec: 1 },
  log: [],
};

const app = Fastify({ logger: true });
app.get("/health", async () => ({ status: "up", service: "chaos-control", version: "0.1.0" }));
app.get("/metrics", async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));
app.get("/chaos/state", async () => state);

await app.listen({ host: "0.0.0.0", port });
