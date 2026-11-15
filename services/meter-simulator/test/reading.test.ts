import assert from "node:assert/strict";
import { test } from "node:test";
import { COUNTIES, REGIONS } from "../src/geo.js";
import { buildPopulation } from "../src/population.js";
import { buildInterval, buildReading, bucharestOffsetMs, INTERVAL_MS, type MeterReadingFile } from "../src/reading.js";

const sizing = { minBytes: 1024, maxBytes: 50 * 1024 };
const meters = buildPopulation(500);
const day = Date.UTC(2026, 10, 11); // Wednesday 11 Nov 2026, 00:00 UTC

test("meter ids are stable and per-region, and growing the fleet does not renumber", () => {
  const bigger = buildPopulation(800);
  assert.deepEqual(bigger.slice(0, 500), meters);
  assert.equal(new Set(meters.map((m) => m.meterId)).size, 500);
  for (const m of meters) assert.match(m.meterId, /^RO-(MT|BN|DB)-\d{6}$/);
  const regions = new Set(meters.map((m) => m.region));
  assert.deepEqual([...regions].sort(), [...REGIONS].sort());
  const countyNames = new Set(COUNTIES.map((c) => c.name));
  for (const m of meters) assert.ok(countyNames.has(m.county), m.county);
  // Every meter stays inside Romania's bounding box.
  for (const m of meters) assert.ok(m.lat > 43.6 && m.lat < 48.3 && m.lon > 20.2 && m.lon < 29.8, `${m.meterId} ${m.lat},${m.lon}`);
});

test("the same reading identity always produces the same bytes and key", () => {
  const meter = meters[123]!;
  const ref = { meterIndex: 123, periodStartMs: day, seq: 42, intervals: 4 };
  const a = buildReading(meter, ref, sizing);
  const b = buildReading(meter, ref, sizing);
  assert.equal(a.body, b.body);
  assert.equal(a.idempotencyKey, `${meter.meterId}:2026-11-11T00:00:00Z:42`);
  const other = buildReading(meter, { ...ref, seq: 43 }, sizing);
  assert.notEqual(other.idempotencyKey, a.idempotencyKey);
});

test("files are valid MeterReadingFile JSON within 1-50 KB", () => {
  for (const intervals of [1, 4, 96, 384]) {
    for (let i = 0; i < 50; i++) {
      const meter = meters[i]!;
      const r = buildReading(meter, { meterIndex: i, periodStartMs: day + i * INTERVAL_MS, seq: i + 1, intervals }, sizing);
      assert.equal(Buffer.byteLength(r.body), r.bytes);
      assert.ok(r.bytes >= 1024 && r.bytes <= 50 * 1024, `${intervals} intervals: ${r.bytes} bytes`);
      const file = JSON.parse(r.body) as MeterReadingFile;
      for (const key of ["meterId", "region", "county", "periodStart", "seq", "intervals"] as const) assert.ok(key in file, key);
      assert.ok(REGIONS.includes(file.region));
      assert.equal(file.intervals.length, intervals);
      assert.match(file.periodStart, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/);
      for (const iv of file.intervals) {
        assert.ok(iv.kwh >= 0);
        for (const f of iv.flags ?? []) assert.ok(["tamper", "power_loss", "clock_drift"].includes(f));
      }
    }
  }
});

test("daily load curve: night trough, morning and evening peaks (Bucharest local time)", () => {
  const households = meters.filter((m) => m.kind === "household").slice(0, 200);
  // Average over 5 weekdays to wash out the noise.
  const meanAt = (localHour: number): number => {
    let sum = 0;
    let n = 0;
    for (let d = 0; d < 5; d++) {
      const local = Date.UTC(2026, 10, 9 + d, localHour); // Mon 9 .. Fri 13 Nov
      const utc = local - bucharestOffsetMs(local);
      for (const m of households) {
        sum += buildInterval(m, utc).kwh / (m.dailyKwh / 96);
        n++;
      }
    }
    return sum / n;
  };
  const night = meanAt(3);
  const morning = meanAt(7);
  const midday = meanAt(13);
  const evening = meanAt(19);
  assert.ok(night < 0.6, `night ${night}`);
  assert.ok(morning > midday && morning > night * 2, `morning ${morning}`);
  assert.ok(evening > morning && evening > 1.5, `evening ${evening}`);
});

test("voltage stays around 230 V within EN 50160 limits", () => {
  const volts: number[] = [];
  // Planted voltage sags are covered by their own test below.
  for (const meter of meters.slice(0, 200).filter((m) => m.fault?.kind !== "voltage_sag")) {
    for (let q = 0; q < 96; q++) {
      const v = buildInterval(meter, day + q * INTERVAL_MS).voltage;
      if (v !== undefined) volts.push(v);
    }
  }
  const mean = volts.reduce((s, v) => s + v, 0) / volts.length;
  assert.ok(Math.abs(mean - 230) < 1.5, `mean ${mean}`);
  assert.ok(volts.every((v) => v >= 207 && v <= 253));
});

test("Bucharest offset follows EU summer time", () => {
  assert.equal(bucharestOffsetMs(Date.UTC(2026, 10, 14, 12)), 2 * 3_600_000);
  assert.equal(bucharestOffsetMs(Date.UTC(2026, 6, 1, 12)), 3 * 3_600_000);
  // 2026: summer time from Sun 29 March 01:00 UTC to Sun 25 October 01:00 UTC.
  assert.equal(bucharestOffsetMs(Date.UTC(2026, 2, 29, 0, 59)), 2 * 3_600_000);
  assert.equal(bucharestOffsetMs(Date.UTC(2026, 2, 29, 1, 0)), 3 * 3_600_000);
  assert.equal(bucharestOffsetMs(Date.UTC(2026, 9, 25, 1, 0)), 2 * 3_600_000);
});

test("a few meters carry planted faults that recur and replay identically", () => {
  const faulty = meters.filter((m) => m.fault);
  assert.ok(faulty.length >= 10 && faulty.length <= 40, `${faulty.length} faulty meters`);
  assert.equal(new Set(faulty.map((m) => m.fault?.kind)).size, 4);
  for (const m of faulty) {
    const day1 = Array.from({ length: 96 }, (_, q) => buildInterval(m, day + q * INTERVAL_MS));
    assert.deepEqual(day1, Array.from({ length: 96 }, (_, q) => buildInterval(m, day + q * INTERVAL_MS)));
    const kwh = day1.map((iv) => iv.kwh);
    if (m.fault?.kind === "voltage_sag") assert.ok(day1.some((iv) => iv.voltage !== undefined && iv.voltage < 207));
    if (m.fault?.kind === "stuck_meter") assert.ok(kwh.some((_, i) => i >= 7 && new Set(kwh.slice(i - 7, i + 1)).size === 1));
    if (m.fault?.kind === "spike") assert.ok(Math.max(...kwh) > 4 * (m.dailyKwh / 96));
  }
});
