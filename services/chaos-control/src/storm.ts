// Load spike on one category, to show a 10x storm in one category does not degrade the
// others (NFR scalability). Meters: the simulator's rate is multiplied for the duration.
// Outage/document: chaos-control uploads files itself at the category's baseline rate × multiplier.
import { randomBytes } from "node:crypto";
import type { Counter } from "prom-client";
import { ChaosError } from "./storages.js";

export type Category = "meter" | "outage" | "document" | "video";

export interface StormRequest {
  category: Category;
  multiplier: number;
  durationSec: number;
}

export interface StormState {
  category: Category;
  multiplier: number;
  endsAt: string;
}

/** Baseline arrivals per category (uploads/s) and file size: what a normal day looks like. */
export const UPLOAD_BASELINE: Record<"outage" | "document", { perSec: number; bytes: number }> = {
  // Outage records: 1-10 MB in the brief; 2 MB keeps a 10x storm at ~10 MB/s on a laptop.
  outage: { perSec: 0.5, bytes: 2 * 1024 * 1024 },
  document: { perSec: 0.5, bytes: 512 * 1024 },
};

const MAX_IN_FLIGHT = 32;
const REGIONS = ["muntenia", "banat", "dobrogea"] as const;

export interface MeterControl {
  getBaseRate(): Promise<number>;
  setBaseRate(readingsPerSec: number): Promise<void>;
}

export interface StormDeps {
  apiUrl: string;
  meters: MeterControl;
  uploads: Counter<"category" | "result">;
  log: (msg: string, extra?: object) => void;
  fetchFn?: typeof fetch;
}

interface Running {
  state: StormState;
  stop: (restore: boolean) => Promise<void>;
}

export class Storms {
  private current: Running | undefined;

  constructor(private readonly deps: StormDeps) {}

  state(): StormState | undefined {
    return this.current?.state;
  }

  /** Ends the running storm. restore=false leaves the meter rate as someone just set it. */
  async stop(restore = true): Promise<void> {
    const c = this.current;
    this.current = undefined;
    if (c) await c.stop(restore);
  }

  async start(req: StormRequest, authorization: string | undefined): Promise<StormState> {
    if (req.category === "video") {
      throw new ChaosError(409, "UNSUPPORTED", "video storms need the tus upload path (zone A, P1); use meter, outage or document");
    }
    await this.stop();
    const state: StormState = {
      category: req.category,
      multiplier: req.multiplier,
      endsAt: new Date(Date.now() + req.durationSec * 1000).toISOString(),
    };
    const run = req.category === "meter" ? await this.meterStorm(req) : this.uploadStorm(req.category, req.multiplier, authorization);
    const timer = setTimeout(() => {
      if (this.current?.state === state) void this.stop();
    }, req.durationSec * 1000);
    this.current = {
      state,
      stop: async (restore) => {
        clearTimeout(timer);
        await run(restore);
        this.deps.log("storm ended", { category: req.category });
      },
    };
    return state;
  }

  private async meterStorm(req: StormRequest): Promise<(restore: boolean) => Promise<void>> {
    const base = await this.deps.meters.getBaseRate();
    await this.deps.meters.setBaseRate(Math.min(5000, base * req.multiplier));
    return async (restore) => {
      if (restore) await this.deps.meters.setBaseRate(base);
    };
  }

  private uploadStorm(category: "outage" | "document", multiplier: number, authorization: string | undefined): (restore: boolean) => Promise<void> {
    const { perSec, bytes } = UPLOAD_BASELINE[category];
    const rate = perSec * multiplier;
    const fetchFn = this.deps.fetchFn ?? fetch;
    let inFlight = 0;
    let sent = 0;
    const startedAt = performance.now();
    const fire = (): void => {
      // Open loop: arrivals do not wait for the API, so a slow API builds a real queue.
      // In-flight is capped so chaos-control itself cannot run out of memory.
      if (inFlight >= MAX_IN_FLIGHT) {
        this.deps.uploads.inc({ category, result: "skipped" });
        return;
      }
      inFlight++;
      const form = new FormData();
      form.set("category", category);
      form.set("region", REGIONS[sent % REGIONS.length] ?? "muntenia");
      form.set("description", `chaos storm x${multiplier}`);
      form.set("file", new Blob([randomBytes(bytes)]), `storm-${category}-${sent}.bin`);
      fetchFn(this.deps.apiUrl, {
        method: "POST",
        body: form,
        // The storm acts on behalf of the admin who started it.
        headers: authorization ? { authorization } : {},
        signal: AbortSignal.timeout(120_000),
      })
        .then(async (res) => {
          await res.arrayBuffer();
          this.deps.uploads.inc({ category, result: res.ok ? "ok" : "error" });
        })
        .catch(() => this.deps.uploads.inc({ category, result: "error" }))
        .finally(() => inFlight--);
    };
    const timer = setInterval(() => {
      const due = Math.floor((rate * (performance.now() - startedAt)) / 1000) - sent;
      for (let i = 0; i < due; i++) {
        sent++;
        fire();
      }
    }, 50);
    return async () => clearInterval(timer);
  }
}
