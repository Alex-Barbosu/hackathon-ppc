import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ApiClient } from "./client.js";
import { executeRun, planCells } from "./runner.js";
import type { RunStore } from "./store.js";
import type { Run } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The role claim is checked from the bearer token's payload only to gate the UI-facing route;
// filegrid-api is the real authority on every call the run itself makes.
function isAdmin(header: string | undefined): boolean {
  try {
    const payload = JSON.parse(Buffer.from((header ?? "").replace(/^Bearer /, "").split(".")[1] ?? "", "base64url").toString()) as { role?: string; exp?: number };
    return payload.role === "admin" && (payload.exp ?? 0) > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function storageLabRoutes(app: FastifyInstance, store: RunStore, apiUrl: string, secret: string): void {
  const api = new ApiClient(apiUrl, secret);

  app.post<{ Body: { samplesPerCell?: number } | undefined }>("/insights/storage-lab/runs", async (req, reply) => {
    if (!isAdmin(req.headers.authorization)) return reply.code(403).send({ code: "FORBIDDEN", message: "Storage Lab needs the admin role" });
    const n = req.body?.samplesPerCell ?? 20;
    if (!Number.isInteger(n) || n < 1 || n > 200) return reply.code(400).send({ code: "BAD_REQUEST", message: "samplesPerCell must be 1..200" });
    if ((await store.latest())?.status === "running") return reply.code(409).send({ code: "CONFLICT", message: "A run is already in progress" });
    const run: Run = { id: randomUUID(), status: "running", startedAt: new Date().toISOString(), samplesPerCell: n, cells: planCells(n), recommendation: [] };
    await store.create(run);
    void executeRun(run, api, store, (m) => app.log.info(m));
    return reply.code(202).send(run);
  });

  app.get("/insights/storage-lab/runs/latest", async (_req, reply) => {
    const run = await store.latest();
    return run ?? reply.code(404).send({ code: "NOT_FOUND", message: "No benchmark has run yet" });
  });

  app.get<{ Params: { runId: string } }>("/insights/storage-lab/runs/:runId", async (req, reply) => {
    if (!UUID.test(req.params.runId)) return reply.code(400).send({ code: "BAD_REQUEST", message: "runId must be a UUID" });
    return (await store.get(req.params.runId)) ?? reply.code(404).send({ code: "NOT_FOUND", message: "No such run" });
  });
}
