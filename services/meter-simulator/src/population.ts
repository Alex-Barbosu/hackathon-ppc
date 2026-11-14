import { COUNTIES, REGION_CODE, type Region } from "./geo.js";
import { gaussian, pickWeighted, rng } from "./random.js";

export type MeterKind = "household" | "business";

export interface Meter {
  index: number;
  meterId: string;
  region: Region;
  county: string;
  lat: number;
  lon: number;
  firmware: string;
  kind: MeterKind;
  /** Mean consumption per day; the load curve shapes it over the 96 quarter hours. */
  dailyKwh: number;
  /** Steady offset from 230 V: distance from the transformer, tap setting. */
  voltageOffset: number;
}

const FIRMWARE = ["3.2.1", "3.2.4", "3.3.0"] as const;

/**
 * Meter i depends only on its index (and on meters before it for the per-region number),
 * so raising METER_COUNT adds meters without changing the ids of existing ones.
 */
export function buildPopulation(count: number): Meter[] {
  const perRegion: Record<Region, number> = { muntenia: 0, banat: 0, dobrogea: 0 };
  const meters: Meter[] = [];
  for (let index = 0; index < count; index++) {
    const r = rng(`meter:${index}`);
    const county = pickWeighted(r, COUNTIES);
    const number = ++perRegion[county.region];
    const kind: MeterKind = r() < 0.88 ? "household" : "business";
    // Romanian households average ~2,000-2,500 kWh/year; businesses vary by an order of magnitude.
    const dailyKwh =
      kind === "household"
        ? clamp(6.5 * Math.exp(0.35 * gaussian(r)), 1.5, 25)
        : clamp(60 * Math.exp(0.5 * gaussian(r)), 10, 400);
    meters.push({
      index,
      meterId: `RO-${REGION_CODE[county.region]}-${String(number).padStart(6, "0")}`,
      region: county.region,
      county: county.name,
      lat: round(county.lat + county.spreadDeg * 0.5 * gaussian(r), 4),
      lon: round(county.lon + county.spreadDeg * 0.5 * gaussian(r), 4),
      firmware: FIRMWARE[Math.floor(r() * FIRMWARE.length)] ?? "3.2.1",
      kind,
      dailyKwh,
      voltageOffset: clamp(2 * gaussian(r), -6, 6),
    });
  }
  return meters;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
