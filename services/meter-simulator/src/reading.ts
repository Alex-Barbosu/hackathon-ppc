// Builds one MeterReadingFile (contracts/openapi.yaml). Values are a pure function of the
// reading's identity, so retries and post-restart replays resend byte-identical bodies.
import type { Region } from "./geo.js";
import { clamp, round, type Meter } from "./population.js";
import { applyFault } from "./faults.js";
import { gaussian, rng } from "./random.js";

export const INTERVAL_MS = 15 * 60 * 1000;

export type Flag = "tamper" | "power_loss" | "clock_drift";

export interface Interval {
  ts: string;
  kwh: number;
  voltage?: number;
  flags?: Flag[];
}

export interface MeterReadingFile {
  meterId: string;
  region: Region;
  county: string;
  lat: number;
  lon: number;
  periodStart: string;
  seq: number;
  firmware: string;
  intervals: Interval[];
}

/** What identifies a reading; everything else is derived from it. */
export interface ReadingRef {
  meterIndex: number;
  periodStartMs: number;
  seq: number;
  intervals: number;
}

export interface BuiltReading {
  idempotencyKey: string;
  body: string;
  bytes: number;
}

export interface Sizing {
  minBytes: number;
  maxBytes: number;
}

// Relative load per local hour (mean of each curve is normalised to 1 below).
// Households: night trough, a morning peak around 07-08 and the larger evening peak
// around 19-20 (cooking, lighting, heating in November). Weekends shift the morning later.
const HOUSEHOLD_WEEKDAY = [0.55, 0.45, 0.4, 0.38, 0.38, 0.45, 0.75, 1.15, 1.2, 0.95, 0.85, 0.85, 0.9, 0.9, 0.85, 0.85, 0.95, 1.25, 1.65, 1.9, 1.85, 1.6, 1.2, 0.8];
const HOUSEHOLD_WEEKEND = [0.6, 0.5, 0.42, 0.4, 0.38, 0.4, 0.5, 0.7, 1.0, 1.3, 1.3, 1.2, 1.2, 1.1, 1.0, 0.95, 1.0, 1.25, 1.6, 1.85, 1.8, 1.6, 1.25, 0.85];
// Businesses: flat working-hours plateau, low base load at night and on weekends.
const BUSINESS_WEEKDAY = [0.35, 0.35, 0.35, 0.35, 0.35, 0.4, 0.55, 0.9, 1.5, 1.7, 1.75, 1.75, 1.6, 1.7, 1.75, 1.7, 1.6, 1.4, 1.0, 0.7, 0.5, 0.42, 0.38, 0.35];
const BUSINESS_WEEKEND = [0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.38, 0.42, 0.5, 0.55, 0.6, 0.6, 0.6, 0.6, 0.55, 0.5, 0.45, 0.42, 0.4, 0.38, 0.36, 0.35, 0.35, 0.35];

function normalise(curve: number[]): number[] {
  const mean = curve.reduce((s, x) => s + x, 0) / curve.length;
  return curve.map((x) => x / mean);
}

const CURVES = {
  household: { weekday: normalise(HOUSEHOLD_WEEKDAY), weekend: normalise(HOUSEHOLD_WEEKEND) },
  business: { weekday: normalise(BUSINESS_WEEKDAY), weekend: normalise(BUSINESS_WEEKEND) },
} as const;

/** Europe/Bucharest offset: EET (+2), EEST (+3) between the last Sundays of March and October at 01:00 UTC. */
export function bucharestOffsetMs(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const lastSunday0100 = (month: number): number => {
    const lastDay = Date.UTC(year, month + 1, 0, 1);
    return lastDay - new Date(lastDay).getUTCDay() * 86_400_000;
  };
  const summer = utcMs >= lastSunday0100(2) && utcMs < lastSunday0100(9);
  return (summer ? 3 : 2) * 3_600_000;
}

/** Load-curve factor (mean 1 over a day) at the middle of the quarter hour starting at utcMs. */
export function loadShape(kind: Meter["kind"], utcMs: number): number {
  const local = new Date(utcMs + bucharestOffsetMs(utcMs) + INTERVAL_MS / 2);
  const day = local.getUTCDay();
  const curve = CURVES[kind][day === 0 || day === 6 ? "weekend" : "weekday"];
  const h = local.getUTCHours() + local.getUTCMinutes() / 60;
  const i = Math.floor(h);
  const a = curve[i] ?? 1;
  const b = curve[(i + 1) % 24] ?? 1;
  return a + (b - a) * (h - i);
}

export function buildInterval(meter: Meter, tsMs: number): Interval {
  // Seeded per (meter, timestamp): the same quarter hour always has the same value,
  // whichever reading file carries it.
  const r = rng(`${meter.meterId}:${tsMs}`);
  const day = Math.floor((tsMs + bucharestOffsetMs(tsMs)) / 86_400_000);
  // Day-to-day variation (weather, occupancy), shared by every interval of that day.
  const dayFactor = Math.exp(0.12 * gaussian(rng(`${meter.meterId}:day:${day}`)));
  const shape = loadShape(meter.kind, tsMs);
  const noise = Math.exp((meter.kind === "household" ? 0.25 : 0.1) * gaussian(r));
  let kwh = (meter.dailyKwh / 96) * shape * dayFactor * noise;
  // Voltage sags a little under load (line drop), around 230 V within EN 50160's ±10 %.
  let voltage: number | undefined = clamp(230 + meter.voltageOffset - 2.5 * (shape - 1) + 0.8 * gaussian(r), 207, 253);
  const flags: Flag[] = [];
  const event = r();
  if (event < 0.0005) {
    // Supply interrupted for part of the quarter hour: less energy, no valid voltage average.
    flags.push("power_loss");
    kwh *= r();
    voltage = undefined;
  } else if (event < 0.0008) {
    flags.push("clock_drift");
  }
  if (meter.fault) ({ kwh, voltage } = applyFault(meter.fault, tsMs, INTERVAL_MS, meter.dailyKwh / 96, { kwh, voltage }));
  const interval: Interval = { ts: isoSeconds(tsMs), kwh: round(kwh, 3) };
  if (voltage !== undefined) interval.voltage = round(voltage, 1);
  if (flags.length > 0) interval.flags = flags;
  return interval;
}

export function buildReading(meter: Meter, ref: ReadingRef, sizing: Sizing): BuiltReading {
  const periodStart = isoSeconds(ref.periodStartMs);
  const file: MeterReadingFile = {
    meterId: meter.meterId,
    region: meter.region,
    county: meter.county,
    lat: meter.lat,
    lon: meter.lon,
    periodStart,
    seq: ref.seq,
    firmware: meter.firmware,
    intervals: Array.from({ length: ref.intervals }, (_, i) => buildInterval(meter, ref.periodStartMs + i * INTERVAL_MS)),
  };
  let body = JSON.stringify(file);
  let bytes = Buffer.byteLength(body);
  // Pad with trailing whitespace (insignificant per RFC 8259 §2) to a seeded target size,
  // so files spread over the 1-50 KB range without adding a field to the contract.
  const r = rng(`${meter.meterId}:${ref.periodStartMs}:${ref.seq}:size`);
  const target = Math.floor(sizing.minBytes + r() * (sizing.maxBytes - sizing.minBytes));
  if (bytes < target) {
    body += "\n" + " ".repeat(target - bytes - 1);
    bytes = target;
  }
  return { idempotencyKey: `${meter.meterId}:${periodStart}:${ref.seq}`, body, bytes };
}

/** ISO 8601 without milliseconds, as in the contract examples (2026-11-14T10:00:00Z). */
export function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
