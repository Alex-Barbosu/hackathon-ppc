// Meter simulator: N virtual smart meters in Muntenia, Banat and Dobrogea pushing reading
// files to FileGrid (gating requirement 7). Control surface on port 9100, internal only:
// the gateway does not route here; the public way in is POST /chaos/meters (chaos-control).
import Fastify from "fastify";
import { loadConfig, MAX_RATE, type Profile } from "./config.js";
import { createMetrics } from "./metrics.js";
import { Simulator } from "./simulator.js";
import { loadState, saveState, type SimState } from "./state.js";

const SAVE_EVERY_MS = 2000;
const SUMMARY_EVERY_MS = 10_000;

const config = loadConfig();
const app = Fastify({ logger: true });
// Health checks and scrapes hit every few seconds; logging each one would bury real events.
const quietRoute = { logLevel: "warn" } as const;
const metrics = createMetrics();

let persist = true;
let saved: SimState | undefined;
try {
  saved = await loadState(config.statePath);
} catch (err) {
  // A corrupt state file must not stop the meters; start fresh and say so.
  app.log.error({ err, path: config.statePath }, "could not read simulator state; starting from a fresh clock");
}
const sim = new Simulator(config, metrics, app.log, saved);

async function save(): Promise<void> {
  if (!persist) return;
  try {
    await saveState(config.statePath, sim.snapshot());
  } catch (err) {
    persist = false;
    app.log.warn({ err, path: config.statePath }, "cannot persist simulator state; restarts will start a fresh clock");
  }
}

app.get("/health", quietRoute, async () => ({
  status: "up",
  service: "meter-simulator",
  version: "0.2.0",
  ...sim.rate(),
  meters: config.meterCount,
  simulatedTime: sim.simulatedTime(),
  pending: sim.sender.pendingCount(),
  target: config.targetUrl,
}));

app.get("/metrics", quietRoute, async (_req, reply) => reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()));

app.get("/rate", async () => sim.rate());

app.post<{ Body: { readingsPerSec?: number; profile?: Profile } }>(
  "/rate",
  {
    schema: {
      body: {
        type: "object",
        minProperties: 1,
        additionalProperties: false,
        properties: {
          readingsPerSec: { type: "number", minimum: 0, maximum: MAX_RATE },
          profile: { type: "string", enum: ["normal", "peak"] },
        },
      },
    },
  },
  async (req) => {
    const change: { readingsPerSec?: number; profile?: Profile } = {};
    if (req.body.readingsPerSec !== undefined) change.readingsPerSec = req.body.readingsPerSec;
    if (req.body.profile !== undefined) change.profile = req.body.profile;
    return sim.setRate(change);
  },
);

await app.listen({ host: "0.0.0.0", port: config.port });
sim.start();
app.log.info({ ...sim.rate(), meters: config.meterCount, target: config.targetUrl, simulatedTime: sim.simulatedTime() }, "meters started");

const saveTimer = setInterval(() => void save(), SAVE_EVERY_MS);
const summaryTimer = setInterval(() => {
  const { sender } = sim;
  if (sender.failures === 0 && sender.rejected === 0) return;
  app.log.warn(
    { failures: sender.failures, rejected: sender.rejected, lastError: sender.lastError, pending: sender.pendingCount() },
    "target errors in the last 10s; retrying with the same Idempotency-Key",
  );
  sender.failures = 0;
  sender.rejected = 0;
}, SUMMARY_EVERY_MS);

// docker stop sends SIGTERM: stop generating, let in-flight requests settle, then save what
// is still unacked so the next start resends it under the same keys.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "stopping meters");
  sim.stopGenerating();
  clearInterval(saveTimer);
  clearInterval(summaryTimer);
  await sim.sender.stop(3000);
  await save();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
