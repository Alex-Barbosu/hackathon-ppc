// Delivers readings at-least-once; the server's idempotency turns that into exactly-once.
// A reading stays pending until the target acks it (201 accepted / 200 duplicate), like a
// real meter that keeps its buffer until the head-end confirms. Retries never give up on
// transient failures and always resend the same Idempotency-Key with the same body.
import { randomBytes } from "node:crypto";
import type { Region } from "./geo.js";
import type { SimMetrics } from "./metrics.js";
import type { BuiltReading, ReadingRef } from "./reading.js";

export interface SenderOptions {
  targetUrl: string;
  deviceToken: string;
  maxInFlight: number;
  requestTimeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface SenderDeps {
  options: SenderOptions;
  metrics: SimMetrics;
  log: Logger;
  build: (ref: ReadingRef) => BuiltReading;
  regionOf: (meterIndex: number) => Region;
  fetchFn?: typeof fetch;
  random?: () => number;
}

interface Delivery {
  ref: ReadingRef;
  region: Region;
  /** Attempts already made; > 0 on the next send means this send is a retry. */
  attempts: number;
  /** One trace per reading, so every retry of it shows up in the same trace. */
  traceId: string;
}

/** Statuses where resending the same bytes cannot succeed: the reading itself is refused. */
const PERMANENT = new Set([400, 413, 422]);

export function backoffMs(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  // "Full jitter": spreads retries of many meters so a recovering API is not hit in lockstep.
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

export function refKey(ref: ReadingRef): string {
  return `${ref.meterIndex}:${ref.periodStartMs}:${ref.seq}`;
}

export class Sender {
  private readonly ready: Delivery[] = [];
  private readyHead = 0;
  private readonly pending = new Map<string, Delivery>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private inFlight = 0;
  private stopped = false;
  private readonly fetchFn: typeof fetch;
  private readonly random: () => number;
  private readonly isMock: boolean;
  /** Failures since the last summary, so a dead target logs once per interval, not per request. */
  failures = 0;
  lastError = "";
  rejected = 0;

  constructor(private readonly deps: SenderDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.random = deps.random ?? Math.random;
    this.isMock = deps.options.targetUrl.includes("mock-api");
  }

  /** A freshly generated reading (counted as sent by the caller). */
  submit(ref: ReadingRef): void {
    this.enqueue({ ref, region: this.deps.regionOf(ref.meterIndex), attempts: 0, traceId: randomBytes(16).toString("hex") });
  }

  /** A reading that was pending when the previous process stopped: resending it is a retry. */
  replay(ref: ReadingRef): void {
    this.enqueue({ ref, region: this.deps.regionOf(ref.meterIndex), attempts: 1, traceId: randomBytes(16).toString("hex") });
  }

  pendingCount(): number {
    return this.pending.size;
  }

  inFlightCount(): number {
    return this.inFlight;
  }

  pendingRefs(): ReadingRef[] {
    return [...this.pending.values()].map((d) => d.ref);
  }

  /** Stops sending; resolves once in-flight requests settle or the timeout passes. */
  async stop(timeoutMs: number): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  }

  private enqueue(d: Delivery): void {
    const key = refKey(d.ref);
    if (this.pending.has(key)) return;
    this.pending.set(key, d);
    this.ready.push(d);
    this.pump();
  }

  private pump(): void {
    while (!this.stopped && this.inFlight < this.deps.options.maxInFlight && this.readyHead < this.ready.length) {
      const d = this.ready[this.readyHead++];
      if (d) void this.attempt(d);
    }
    // Compact the queue array once its consumed prefix dominates, keeping pushes O(1).
    if (this.readyHead > 1024 && this.readyHead * 2 > this.ready.length) {
      this.ready.splice(0, this.readyHead);
      this.readyHead = 0;
    }
  }

  private async attempt(d: Delivery): Promise<void> {
    this.inFlight++;
    const { options, metrics, log } = this.deps;
    if (d.attempts > 0) metrics.retries.inc({ region: d.region });
    d.attempts++;
    let outcome: "accepted" | "duplicate" | "rejected" | "retry" = "retry";
    let detail = "";
    try {
      // Rebuilt from the reading's identity: deterministic, so the bytes match every earlier attempt.
      const reading = this.deps.build(d.ref);
      const res = await this.fetchFn(options.targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.deviceToken}`,
          "idempotency-key": reading.idempotencyKey,
          traceparent: `00-${d.traceId}-${randomBytes(8).toString("hex")}-01`,
          // Prism answers with the lowest 2xx (200 = duplicate) unless told otherwise.
          ...(this.isMock ? { prefer: "code=201" } : {}),
        },
        body: reading.body,
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      });
      // Drain the body so the keep-alive connection is reused.
      await res.arrayBuffer();
      if (res.status === 200) outcome = "duplicate";
      else if (res.ok) outcome = "accepted";
      else if (PERMANENT.has(res.status)) outcome = "rejected";
      detail = `HTTP ${res.status}`;
      if (outcome === "rejected") {
        log.error({ idempotencyKey: reading.idempotencyKey, status: res.status, traceId: d.traceId }, "reading rejected by target; not retrying");
      }
    } catch (err) {
      detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    } finally {
      this.inFlight--;
    }
    if (outcome === "accepted" || outcome === "duplicate") {
      metrics.acked.inc({ region: d.region, result: outcome });
      this.pending.delete(refKey(d.ref));
    } else if (outcome === "rejected") {
      // Not acked, so sent minus acked keeps the gap visible and MeterReadingLossRisk can fire.
      this.rejected++;
      this.pending.delete(refKey(d.ref));
    } else {
      this.failures++;
      this.lastError = detail;
      this.scheduleRetry(d);
    }
    this.pump();
  }

  private scheduleRetry(d: Delivery): void {
    if (this.stopped) return;
    const { retryBaseMs, retryMaxMs } = this.deps.options;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.ready.push(d);
      this.pump();
    }, backoffMs(d.attempts, retryBaseMs, retryMaxMs, this.random));
    this.timers.add(t);
  }
}
