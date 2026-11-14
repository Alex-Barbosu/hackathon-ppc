// /chaos/* per contracts/openapi.yaml (ChaosState, NetworkCondition). Built as a factory
// with injected clients so tests run without Docker, Toxiproxy or the simulator.
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";
import { authorizeAdmin } from "./auth.js";
import type { RateState } from "./meters.js";
import { ChaosError, type StorageName, type Storages } from "./storages.js";
import { Storms, type StormRequest, type MeterControl } from "./storm.js";
import type { NetworkCondition, ToxiproxyApi } from "./toxiproxy.js";

export interface MetersApi extends MeterControl {
  rate(): Promise<RateState>;
  set(change: { readingsPerSec?: number; profile?: "normal" | "peak" }): Promise<RateState>;
}

export interface AppDeps {
  jwtSecret: string;
  storages: Pick<Storages, "states" | "setRunning" | "corrupt">;
  toxiproxy: ToxiproxyApi;
  meters: MetersApi;
  /** Rate the simulator returns to on POST /chaos/reset (its .env value). */
  defaultReadingsPerSec: number;
  apiUrl: string;
  fetchFn?: typeof fetch;
  logger?: boolean;
}

const LOG_SIZE = 50;

export function buildApp(deps: AppDeps): { app: FastifyInstance; registry: Registry; storms: Storms } {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const actions = new Counter({ name: "chaos_actions_total", help: "Chaos actions applied", labelNames: ["action", "result"], registers: [registry] });
  const uploads = new Counter({ name: "chaos_storm_uploads_total", help: "Storm uploads by result", labelNames: ["category", "result"], registers: [registry] });

  const app = Fastify({ logger: deps.logger ?? true });
  const log: { at: string; action: string }[] = [];
  const record = (action: string, by: string): void => {
    log.unshift({ at: new Date().toISOString(), action });
    log.length = Math.min(log.length, LOG_SIZE);
    app.log.info({ action, by }, "chaos action");
  };
  const storms = new Storms({
    apiUrl: deps.apiUrl,
    meters: deps.meters,
    uploads,
    log: (msg, extra) => app.log.info(extra ?? {}, msg),
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
  });

  // Each part of the state comes from its source of truth (Docker, Toxiproxy, simulator), so
  // it stays right after restarts and after anyone uses docker compose by hand.
  async function state(): Promise<object> {
    const [storages, network, meters] = await Promise.all([
      deps.storages.states(),
      deps.toxiproxy.conditions(),
      deps.meters.rate().then((r) => ({ readingsPerSec: r.readingsPerSec })),
    ]);
    const storm = storms.state();
    return { storages, network, meters, ...(storm ? { storm } : {}), log };
  }

  function errorBody(code: string, message: string): object {
    return { code, message, traceId: randomBytes(16).toString("hex") };
  }

  // Buttons like "stop s3" send no body, often still with content-type: application/json.
  // Treat an empty JSON body as no body; routes that need one fail schema validation (400).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString();
    if (text.trim() === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error("body is not valid JSON"), { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, req, reply) => {
    actions.inc({ action: req.routeOptions.url ?? "unknown", result: "error" });
    if (err instanceof ChaosError) return reply.status(err.status).send(errorBody(err.code, err.message));
    if (err.validation) return reply.status(400).send(errorBody("BAD_REQUEST", err.message));
    // Fastify's own client errors (bad JSON, unsupported media type, body too large).
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) return reply.status(err.statusCode).send(errorBody("BAD_REQUEST", err.message));
    app.log.error({ err }, "chaos action failed");
    return reply.status(502).send(errorBody("UPSTREAM_ERROR", err.message));
  });

  const quiet = { logLevel: "warn" } as const;
  app.get("/health", quiet, async () => ({ status: "up", service: "chaos-control", version: "0.2.0" }));
  app.get("/metrics", quiet, async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  // Everything under /chaos needs an admin JWT, reads included: the state reveals which
  // storage is down, and the endpoint is reachable from outside through the gateway.
  const principals = new WeakMap<FastifyRequest, string>();
  app.register(
    async (chaos) => {
      chaos.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
        const auth = authorizeAdmin(req.headers.authorization, deps.jwtSecret);
        if (!auth.ok) return reply.status(auth.status).send(errorBody(auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", auth.message));
        principals.set(req, auth.principal.sub);
      });

      const done = async (req: FastifyRequest, reply: FastifyReply, action: string): Promise<FastifyReply> => {
        actions.inc({ action: req.routeOptions.url ?? "unknown", result: "ok" });
        record(action, principals.get(req) ?? "unknown");
        return reply.status(202).send(await state());
      };

      chaos.get("/state", async () => state());

      chaos.post<{ Params: { storage: StorageName; action: "stop" | "start" } }>(
        "/storages/:storage/:action",
        { schema: { params: { type: "object", required: ["storage", "action"], properties: { storage: { enum: ["db", "s3", "ftp"] }, action: { enum: ["stop", "start"] } } } } },
        async (req, reply) => {
          const { storage, action } = req.params;
          await deps.storages.setRunning(storage, action === "start");
          return done(req, reply, `${action} ${storage}`);
        },
      );

      chaos.post<{ Body: NetworkCondition }>(
        "/network",
        {
          schema: {
            body: {
              type: "object",
              required: ["target"],
              additionalProperties: false,
              properties: {
                target: { enum: ["client", "db", "s3", "ftp"] },
                latencyMs: { type: "integer", minimum: 0, maximum: 60_000 },
                jitterMs: { type: "integer", minimum: 0, maximum: 60_000 },
                lossPct: { type: "number", minimum: 0, maximum: 100 },
                bandwidthKbps: { type: "integer", minimum: 0 },
              },
            },
          },
        },
        async (req, reply) => {
          const c = req.body;
          await deps.toxiproxy.apply(c);
          const parts = [
            c.latencyMs ? `${c.latencyMs}ms` : "",
            c.jitterMs ? `±${c.jitterMs}ms` : "",
            c.lossPct ? `${c.lossPct}% loss` : "",
            c.bandwidthKbps ? `${c.bandwidthKbps}kbps` : "",
          ].filter(Boolean);
          return done(req, reply, parts.length ? `degrade ${c.target}: ${parts.join(", ")}` : `clear network ${c.target}`);
        },
      );

      chaos.post<{ Body: { fileId: string } }>(
        "/corrupt",
        { schema: { body: { type: "object", required: ["fileId"], properties: { fileId: { type: "string", format: "uuid" } } } } },
        async (req, reply) => {
          const r = await deps.storages.corrupt(req.body.fileId);
          return done(req, reply, `corrupt ${req.body.fileId} in ${r.storage} at byte ${r.offset}`);
        },
      );

      chaos.post<{ Body: StormRequest }>(
        "/storm",
        {
          schema: {
            body: {
              type: "object",
              required: ["category", "multiplier", "durationSec"],
              properties: {
                category: { enum: ["meter", "outage", "document", "video"] },
                multiplier: { type: "number", minimum: 1, maximum: 50 },
                durationSec: { type: "integer", minimum: 10, maximum: 1800 },
              },
            },
          },
        },
        async (req, reply) => {
          const s = await storms.start(req.body, req.headers.authorization);
          return done(req, reply, `storm ${s.category} x${s.multiplier} until ${s.endsAt}`);
        },
      );

      chaos.post<{ Body: { readingsPerSec: number } }>(
        "/meters",
        { schema: { body: { type: "object", required: ["readingsPerSec"], properties: { readingsPerSec: { type: "number", minimum: 0, maximum: 5000 } } } } },
        async (req, reply) => {
          // An explicit rate wins over a running meter storm; do not restore the old rate after it.
          if (storms.state()?.category === "meter") await storms.stop(false);
          await deps.meters.set({ readingsPerSec: req.body.readingsPerSec });
          return done(req, reply, `meters ${req.body.readingsPerSec}/s`);
        },
      );

      chaos.post("/reset", async (req, reply) => {
        // Order: end the storm, clear the network, bring storages back, restore meters.
        await storms.stop();
        await deps.toxiproxy.reset();
        await Promise.all((["db", "s3", "ftp"] as const).map((s) => deps.storages.setRunning(s, true)));
        await deps.meters.set({ readingsPerSec: deps.defaultReadingsPerSec, profile: "normal" });
        return done(req, reply, "reset");
      });
    },
    { prefix: "/chaos" },
  );

  return { app, registry, storms };
}
