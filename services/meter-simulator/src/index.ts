// Zone B placeholder. Sends one fake reading per tick to TARGET_URL (the mock API in the
// base) so the pipeline and metrics are wired end to end. The real simulator (regions,
// load curves, retries with the same Idempotency-Key, peak profile) is zone B's backlog.
import Fastify from "fastify";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";

const port = Number(process.env.PORT ?? 9100);
const targetUrl = process.env.TARGET_URL ?? "http://mock-api:4010/api/v1/meter-readings";
const deviceToken = process.env.METER_DEVICE_TOKEN ?? "dev-device-token";
let readingsPerSec = Number(process.env.READINGS_PER_SEC ?? 1);

const registry = new Registry();
collectDefaultMetrics({ register: registry });
const sent = new Counter({ name: "meter_sim_sent_total", help: "Unique readings generated", labelNames: ["region"], registers: [registry] });
const acked = new Counter({ name: "meter_sim_acked_total", help: "Acks received", labelNames: ["region", "result"], registers: [registry] });
const retries = new Counter({ name: "meter_sim_retries_total", help: "Retries with the same key", labelNames: ["region"], registers: [registry] });
const rate = new Gauge({ name: "meter_sim_rate", help: "Configured readings per second", registers: [registry] });
rate.set(readingsPerSec);
void retries; // wired in zone B's retry logic

let seq = 0;

async function sendOne(): Promise<void> {
  const region = "muntenia";
  const meterId = "RO-MT-000001";
  const periodStart = new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString();
  const reading = {
    meterId,
    region,
    county: "Prahova",
    periodStart,
    seq: seq++,
    intervals: [{ ts: periodStart, kwh: Number((Math.random() * 0.5).toFixed(3)), voltage: 230 }],
  };
  sent.inc({ region });
  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deviceToken}`,
        "idempotency-key": `${meterId}:${periodStart}:${reading.seq}`,
        // Prism returns the lowest 2xx (200 = duplicate) unless asked; the real API ignores this.
        ...(targetUrl.includes("mock-api") ? { prefer: "code=201" } : {}),
      },
      body: JSON.stringify(reading),
    });
    if (res.ok) acked.inc({ region, result: res.status === 200 ? "duplicate" : "accepted" });
  } catch {
    // Target not up yet; zone B adds retry with backoff and the same key.
  }
}

let timer: NodeJS.Timeout | undefined;
function schedule(): void {
  if (timer) clearInterval(timer);
  if (readingsPerSec > 0) timer = setInterval(() => void sendOne(), 1000 / readingsPerSec);
}

const app = Fastify({ logger: true });
app.get("/health", async () => ({ status: "up", service: "meter-simulator", version: "0.1.0", readingsPerSec }));
app.get("/metrics", async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));
app.post<{ Body: { readingsPerSec: number } }>("/rate", async (req) => {
  readingsPerSec = Math.max(0, Number(req.body.readingsPerSec));
  rate.set(readingsPerSec);
  schedule();
  return { readingsPerSec };
});

await app.listen({ host: "0.0.0.0", port });
schedule();
