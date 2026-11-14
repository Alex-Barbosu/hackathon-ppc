// Generates readings at a global rate, round-robin over the meters, and hands them to the
// sender. Time is simulated: each meter's file covers the next period after its previous
// one, so with N meters at R readings/s the simulated clock runs 900·R/N times faster
// than real time (1.8x at the defaults). That is the only way 500 meters can produce a
// configurable volume while every reported quarter hour stays unique per meter.
import { MAX_RATE, PROFILE_MULTIPLIER, type Config, type Profile } from "./config.js";
import type { SimMetrics } from "./metrics.js";
import { buildPopulation, type Meter } from "./population.js";
import { buildReading, INTERVAL_MS, isoSeconds, type BuiltReading, type ReadingRef } from "./reading.js";
import { Sender, type Logger } from "./sender.js";
import type { MeterCursor, SimState } from "./state.js";

const TICK_MS = 50;

export interface RateState {
  profile: Profile;
  baseReadingsPerSec: number;
  readingsPerSec: number;
}

export class Simulator {
  readonly meters: Meter[];
  private readonly cursors: MeterCursor[];
  private roundRobin: number;
  private baseRate: number;
  private profile: Profile;
  private epoch = performance.now();
  private emitted = 0;
  private timer: NodeJS.Timeout | undefined;
  private warnedAhead = false;
  readonly sender: Sender;

  constructor(
    private readonly config: Config,
    private readonly metrics: SimMetrics,
    private readonly log: Logger,
    saved: SimState | undefined,
    now: number = Date.now(),
    fetchFn?: typeof fetch,
  ) {
    const maxPendingIndex = (saved?.pending ?? []).reduce((m, p) => Math.max(m, p.meterIndex), -1);
    // Replays may belong to meters beyond a since-lowered METER_COUNT; they still get delivered.
    this.meters = buildPopulation(Math.max(config.meterCount, maxPendingIndex + 1));
    const origin = Math.floor((now - config.backfillDays * 86_400_000) / INTERVAL_MS) * INTERVAL_MS;
    const savedCursors = saved?.meters ?? [];
    // Meters added since the last run start at the newest simulated period, as if just installed.
    const newest = savedCursors.reduce((m, c) => Math.max(m, c.nextPeriodMs), origin);
    this.cursors = Array.from({ length: config.meterCount }, (_, i) => savedCursors[i] ?? { nextPeriodMs: savedCursors.length ? newest : origin, nextSeq: 1 });
    this.roundRobin = (saved?.roundRobin ?? 0) % config.meterCount;
    this.baseRate = config.readingsPerSec;
    this.profile = config.profile;
    this.sender = new Sender({
      options: config,
      metrics,
      log,
      build: (ref) => this.build(ref),
      regionOf: (i) => this.meterAt(i).region,
      ...(fetchFn ? { fetchFn } : {}),
    });
    metrics.rate.set(this.rate().readingsPerSec);
    for (const ref of saved?.pending ?? []) this.sender.replay(ref);
    if (saved?.pending.length) log.info({ replayed: saved.pending.length }, "replaying readings not acked before the last stop");
  }

  build(ref: ReadingRef): BuiltReading {
    return buildReading(this.meterAt(ref.meterIndex), ref, this.config);
  }

  start(): void {
    this.epoch = performance.now();
    this.emitted = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopGenerating(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  rate(): RateState {
    return {
      profile: this.profile,
      baseReadingsPerSec: this.baseRate,
      readingsPerSec: Math.min(MAX_RATE, this.baseRate * PROFILE_MULTIPLIER[this.profile]),
    };
  }

  setRate(change: { readingsPerSec?: number; profile?: Profile }): RateState {
    if (change.readingsPerSec !== undefined) this.baseRate = Math.min(MAX_RATE, Math.max(0, change.readingsPerSec));
    if (change.profile !== undefined) this.profile = change.profile;
    // Restart the pacing window so the new rate applies from now, without a catch-up burst.
    this.epoch = performance.now();
    this.emitted = 0;
    const state = this.rate();
    this.metrics.rate.set(state.readingsPerSec);
    this.log.info({ ...state }, "rate changed");
    return state;
  }

  /** Earliest period any meter will report next: where the simulated clock stands. */
  simulatedTime(): string {
    return isoSeconds(this.cursors.reduce((m, c) => Math.min(m, c.nextPeriodMs), Number.POSITIVE_INFINITY));
  }

  snapshot(): SimState {
    return {
      version: 1,
      roundRobin: this.roundRobin,
      meters: this.cursors.map((c) => ({ ...c })),
      pending: this.sender.pendingRefs(),
    };
  }

  /** Emits as many readings as the rate allows since the window began (fractional rates work). */
  tick(nowMs: number = performance.now()): void {
    const { readingsPerSec } = this.rate();
    if (readingsPerSec <= 0) return;
    const due = Math.floor((readingsPerSec * (nowMs - this.epoch)) / 1000) - this.emitted;
    if (due <= 0) return;
    // After an event-loop stall, send at most one second's worth instead of a spike.
    const n = Math.min(due, Math.max(1, Math.ceil(readingsPerSec)));
    this.emitted += due;
    for (let i = 0; i < n; i++) this.generateOne();
  }

  generateOne(): void {
    const meterIndex = this.roundRobin;
    this.roundRobin = (this.roundRobin + 1) % this.cursors.length;
    const cursor = this.cursors[meterIndex];
    if (!cursor) return;
    const ref: ReadingRef = {
      meterIndex,
      periodStartMs: cursor.nextPeriodMs,
      seq: cursor.nextSeq,
      intervals: this.config.intervalsPerFile,
    };
    cursor.nextPeriodMs += this.config.intervalsPerFile * INTERVAL_MS;
    cursor.nextSeq++;
    if (!this.warnedAhead && ref.periodStartMs > Date.now()) {
      this.warnedAhead = true;
      this.log.warn({ periodStart: isoSeconds(ref.periodStartMs) }, "simulated clock passed real time; readings now carry future periods");
    }
    this.metrics.sent.inc({ region: this.meterAt(meterIndex).region });
    this.sender.submit(ref);
  }

  private meterAt(index: number): Meter {
    const meter = this.meters[index];
    if (!meter) throw new Error(`no meter ${index}`);
    return meter;
  }
}
