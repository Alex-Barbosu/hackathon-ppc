import assert from "node:assert/strict";
import { test } from "node:test";
import type { Anomaly, Hotspot, Region } from "../../../lib/domain.ts";
import { buildAnomalyModel, buildMapModel, dotRadius } from "./model.ts";

const h = (county: string, region: Region, outages: number): Hotspot => ({ county, region, outages, totalMinutes: 0, stations: [] });

test("dots are ranked by count and placed on their county; rows without a county are counted, not drawn", () => {
  const m = buildMapModel([h("Tulcea", "dobrogea", 5), h("Not recorded", "muntenia", 2), h("Constanța", "dobrogea", 9)]);
  assert.deepEqual(m.dots.map((d) => [d.county, d.rank]), [["Constanța", 0], ["Tulcea", 1]]);
  assert.equal(m.total, 16);
  assert.equal(m.unplaced, 2);
  assert.deepEqual(m.regions.map((r) => [r.region, r.outages]), [["dobrogea", 14], ["muntenia", 2], ["banat", 0]]);
});

test("dot area grows with the count, so four times the recordings is twice the radius above the minimum", () => {
  assert.equal(dotRadius(9, 9), 9);
  assert.equal(dotRadius(0, 9), 3);
  assert.ok(Math.abs((dotRadius(4, 16) - 3) * 2 - (dotRadius(16, 16) - 3)) < 1e-9);
});

test("no recordings: an empty map, every share zero", () => {
  const m = buildMapModel([]);
  assert.equal(m.dots.length, 0);
  assert.ok(m.regions.every((r) => r.share === 0));
});

const a = (meterId: string, county: string, score: number): Anomaly => ({ meterId, county, region: "dobrogea", kind: "spike", score, at: "2026-11-15T08:00:00Z", explanation: "" });

test("anomaly layer counts distinct meters per county and keeps each meter's strongest anomaly", () => {
  const m = buildAnomalyModel([a("M1", "Tulcea", 3), a("M1", "Tulcea", 7), a("M2", "Constanța", 4), a("M3", "Constanța", 5), a("M4", "", 9)]);
  assert.deepEqual(m.dots.map((d) => [d.county, d.count]), [["Constanța", 2], ["Tulcea", 1]]);
  assert.equal(m.dots[1]?.meters?.[0]?.score, 7);
  assert.equal(m.total, 3);
});
