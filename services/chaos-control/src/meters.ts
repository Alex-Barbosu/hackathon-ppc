// The meter simulator's control API (internal port 9100). POST /chaos/meters lands here.
import type { MeterControl } from "./storm.js";

export interface RateState {
  profile: "normal" | "peak";
  baseReadingsPerSec: number;
  readingsPerSec: number;
}

export class SimulatorClient implements MeterControl {
  constructor(private readonly baseUrl: string) {}

  async rate(): Promise<RateState> {
    const res = await fetch(`${this.baseUrl}/rate`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`meter-simulator GET /rate: HTTP ${res.status}`);
    return (await res.json()) as RateState;
  }

  async set(change: { readingsPerSec?: number; profile?: "normal" | "peak" }): Promise<RateState> {
    const res = await fetch(`${this.baseUrl}/rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`meter-simulator POST /rate: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as RateState;
  }

  async getBaseRate(): Promise<number> {
    return (await this.rate()).baseReadingsPerSec;
  }

  async setBaseRate(readingsPerSec: number): Promise<void> {
    await this.set({ readingsPerSec });
  }
}
