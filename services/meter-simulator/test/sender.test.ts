import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createMetrics, type SimMetrics } from "../src/metrics.js";
import { Simulator } from "../src/simulator.js";
import { backoffMs } from "../src/sender.js";

const quiet = { info() {}, warn() {}, error() {} };

interface Seen {
  key: string;
  bodySha: string;
  traceId: string;
}

/** A fake ingest endpoint: answers with the next status from `script`, then 201 forever. */
async function fakeTarget(script: number[]): Promise<{ url: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        key: String(req.headers["idempotency-key"]),
        bodySha: createHash("sha256").update(Buffer.concat(chunks)).digest("hex"),
        traceId: String(req.headers.traceparent).split("-")[1] ?? "",
      });
      res.writeHead(script.shift() ?? 201, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/v1/meter-readings`, seen, server };
}

function config(targetUrl: string, extra: Record<string, string> = {}) {
  return loadConfig({ METER_TARGET_URL: targetUrl, METER_COUNT: "10", READINGS_PER_SEC: "20", METER_RETRY_BASE_MS: "5", METER_RETRY_MAX_MS: "20", ...extra });
}

async function total(metrics: SimMetrics, name: "sent" | "acked" | "retries", filter: Record<string, string> = {}): Promise<number> {
  const { values } = await metrics[name].get();
  return values.filter((v) => Object.entries(filter).every(([k, x]) => (v.labels as Record<string, string | number | undefined>)[k] === x)).reduce((s, v) => s + v.value, 0);
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("retries reuse the same Idempotency-Key and the same body until acked", async () => {
  const t = await fakeTarget([503, 502, 201]);
  const metrics = createMetrics(false);
  const sim = new Simulator(config(t.url), metrics, quiet, undefined);
  sim.generateOne();
  await until(() => sim.sender.pendingCount() === 0);
  assert.equal(t.seen.length, 3);
  assert.equal(new Set(t.seen.map((s) => s.key)).size, 1);
  assert.equal(new Set(t.seen.map((s) => s.bodySha)).size, 1);
  assert.equal(new Set(t.seen.map((s) => s.traceId)).size, 1, "one trace per reading");
  assert.equal(await total(metrics, "sent"), 1);
  assert.equal(await total(metrics, "retries"), 2);
  assert.equal(await total(metrics, "acked", { result: "accepted" }), 1);
  t.server.close();
});

test("a 200 is counted as a duplicate ack; a 400 is not retried", async () => {
  const t = await fakeTarget([200, 400]);
  const metrics = createMetrics(false);
  const sim = new Simulator(config(t.url), metrics, quiet, undefined);
  sim.generateOne();
  await until(() => sim.sender.pendingCount() === 0);
  sim.generateOne();
  await until(() => sim.sender.pendingCount() === 0);
  assert.equal(t.seen.length, 2);
  assert.equal(await total(metrics, "acked", { result: "duplicate" }), 1);
  assert.equal(await total(metrics, "acked"), 1, "the rejected reading stays un-acked");
  assert.equal(await total(metrics, "sent"), 2);
  t.server.close();
});

test("unreachable target: readings stay pending and are resent after a restart with the same keys", async () => {
  // Port 9 (discard) on localhost: connection refused, a stand-in for a dead API.
  const metrics = createMetrics(false);
  const down = new Simulator(config("http://127.0.0.1:9/x"), metrics, quiet, undefined);
  for (let i = 0; i < 5; i++) down.generateOne();
  await until(() => down.sender.failures >= 5);
  await down.sender.stop(500);
  const saved = down.snapshot();
  assert.equal(saved.pending.length, 5);
  const keysBefore = saved.pending.map((p) => down.build(p).idempotencyKey);

  const t = await fakeTarget([]);
  const metrics2 = createMetrics(false);
  const restarted = new Simulator(config(t.url), metrics2, quiet, saved);
  await until(() => restarted.sender.pendingCount() === 0);
  assert.deepEqual(t.seen.map((s) => s.key).sort(), keysBefore.sort());
  assert.equal(await total(metrics2, "sent"), 0, "replays are not new unique readings");
  assert.equal(await total(metrics2, "retries"), 5);
  // New readings continue after the replayed periods instead of repeating them.
  restarted.generateOne();
  await until(() => restarted.sender.pendingCount() === 0);
  const last = t.seen.at(-1)!.key;
  assert.ok(!keysBefore.includes(last));
  t.server.close();
});

test("pacing honours the configured rate, the peak profile and live changes", () => {
  const metrics = createMetrics(false);
  const sim = new Simulator(config("http://127.0.0.1:9/x", { READINGS_PER_SEC: "2" }), metrics, quiet, undefined);
  const generated = (): number => sim.snapshot().meters.reduce((s, m) => s + m.nextSeq - 1, 0);
  // Drive the ticker with a fake clock: 10 s at 2/s.
  sim.setRate({ readingsPerSec: 2 });
  const t0 = performance.now();
  for (let ms = 0; ms <= 10_000; ms += 50) sim.tick(t0 + ms);
  assert.ok(Math.abs(generated() - 20) <= 1, `normal: ${generated()}`);
  assert.deepEqual(sim.setRate({ profile: "peak" }), { profile: "peak", baseReadingsPerSec: 2, readingsPerSec: 20 });
  const before = generated();
  const t1 = performance.now();
  for (let ms = 0; ms <= 10_000; ms += 50) sim.tick(t1 + ms);
  assert.ok(Math.abs(generated() - before - 200) <= 1, `peak: ${generated() - before}`);
  void sim.sender.stop(0);
});

test("backoff is exponential, capped and jittered", () => {
  assert.equal(backoffMs(1, 250, 30_000, () => 0.999999), 249);
  assert.equal(backoffMs(4, 250, 30_000, () => 0.999999), 1999);
  assert.equal(backoffMs(20, 250, 30_000, () => 0.999999), 29_999);
  assert.equal(backoffMs(5, 250, 30_000, () => 0), 0);
});
