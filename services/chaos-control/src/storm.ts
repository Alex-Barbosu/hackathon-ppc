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

/**
 * Drone videos are few and huge (brief: 100 MB - 1 GB+). A storm uses 32 MB videos so ×10
 * (0.5 videos/s, ~16 MB/s) stays inside a laptop's disk and network budget, while still
 * going through the real path: tus creation, 16 MB PATCH chunks, video's bulkhead.
 */
export const VIDEO_BASELINE = { perSec: 0.05, bytes: 32 * 1024 * 1024, chunkBytes: 16 * 1024 * 1024 };
/** Each video in flight holds one 16 MB chunk; 4 caps chaos-control at ~64 MB for it. */
const MAX_VIDEOS_IN_FLIGHT = 4;
/** A refused or cut chunk is resumed from the server's offset, as a field team's client would. */
const MAX_CHUNK_ATTEMPTS = 20;

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
    await this.stop();
    const state: StormState = {
      category: req.category,
      multiplier: req.multiplier,
      endsAt: new Date(Date.now() + req.durationSec * 1000).toISOString(),
    };
    const run = req.category === "meter" ? await this.meterStorm(req)
      : req.category === "video" ? this.videoStorm(req.multiplier, authorization)
      : this.uploadStorm(req.category, req.multiplier, authorization);
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
    const fire = (): void => {
      // Open loop: arrivals do not wait for the API, so a slow API builds a real queue.
      // In-flight is capped so chaos-control itself cannot run out of memory.
      sent++;
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
    return this.openLoop(rate, fire);
  }

  /** Calls fire() at `rate` per second until the returned stop function runs. */
  private openLoop(rate: number, fire: () => void): (restore: boolean) => Promise<void> {
    let sent = 0;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      const due = Math.floor((rate * (performance.now() - startedAt)) / 1000) - sent;
      for (let i = 0; i < due; i++) {
        sent++;
        fire();
      }
    }, 50);
    return async () => clearInterval(timer);
  }

  private videoStorm(multiplier: number, authorization: string | undefined): (restore: boolean) => Promise<void> {
    const { perSec, bytes, chunkBytes } = VIDEO_BASELINE;
    const fetchFn = this.deps.fetchFn ?? fetch;
    const tusUrl = `${this.deps.apiUrl.replace(/\/$/, "")}/tus`;
    const auth: Record<string, string> = authorization ? { authorization } : {};
    // One random buffer for every video; each video gets its own random first bytes, so
    // no two have the same content (and the same SHA-256) without 32 MB of fresh random each.
    const shared = randomBytes(bytes);
    let started = 0;
    let inFlight = 0;
    let stopped = false;
    const b64 = (s: string): string => Buffer.from(s).toString("base64");

    const upload = async (n: number): Promise<boolean> => {
      const created = await fetchFn(tusUrl, {
        method: "POST",
        headers: {
          ...auth,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(bytes),
          "Upload-Metadata": `category ${b64("video")},filename ${b64(`storm-video-${n}.mp4`)},region ${b64(REGIONS[n % REGIONS.length] ?? "muntenia")}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
      await created.arrayBuffer();
      const location = created.headers.get("location");
      if (created.status !== 201 || !location) return false;
      const url = new URL(location, tusUrl).toString();
      let offset = 0;
      let attempts = 0;
      while (offset < bytes && !stopped) {
        if (++attempts > MAX_CHUNK_ATTEMPTS) return false;
        const end = Math.min(bytes, offset + chunkBytes);
        let chunk = shared.subarray(offset, end);
        if (offset === 0) {
          chunk = Buffer.from(chunk);
          randomBytes(16).copy(chunk, 0);
        }
        const res = await fetchFn(url, {
          method: "PATCH",
          headers: { ...auth, "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
          body: chunk,
          signal: AbortSignal.timeout(120_000),
        }).catch(() => undefined);
        if (res) await res.arrayBuffer();
        if (res?.status === 204) {
          offset = Number(res.headers.get("upload-offset") ?? end);
          continue;
        }
        // Refused (video's bulkhead is full: 503) or cut: wait, then resume where the
        // server says it is, like a field team's tus client. Nothing is sent twice.
        await new Promise((r) => setTimeout(r, 2000));
        const head = await fetchFn(url, { method: "HEAD", headers: { ...auth, "Tus-Resumable": "1.0.0" }, signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
        if (head?.status === 200) offset = Number(head.headers.get("upload-offset") ?? offset);
      }
      return offset >= bytes;
    };

    const fire = (): void => {
      if (inFlight >= MAX_VIDEOS_IN_FLIGHT) {
        this.deps.uploads.inc({ category: "video", result: "skipped" });
        return;
      }
      inFlight++;
      const n = started++;
      upload(n)
        .then((ok) => this.deps.uploads.inc({ category: "video", result: ok ? "ok" : "error" }))
        .catch(() => this.deps.uploads.inc({ category: "video", result: "error" }))
        .finally(() => inFlight--);
    };
    const stopLoop = this.openLoop(perSec * multiplier, fire);
    // Kick off one at once: at 0.5/s the first would otherwise start 2 s in.
    fire();
    return async (restore) => {
      stopped = true;
      await stopLoop(restore);
    };
  }
}
