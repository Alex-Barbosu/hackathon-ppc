import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./testkit.js";
import { explainAnomaly, listAnomalies, listHotspots, queryView } from "./views.js";

test("each anomaly kind is explained in a plain sentence from the view's own numbers", () => {
  const row = { kwh: 0.05, baseline: 1.01, voltage: 190, score: 28.9 };
  assert.match(explainAnomaly("consumption_drop", row), /Used 0\.05 kWh where this meter usually uses 1\.01 kWh/);
  assert.match(explainAnomaly("voltage_sag", row), /Voltage fell to 190 V, below the 207 V limit/);
  assert.match(explainAnomaly("stuck_meter", { ...row, kwh: 2.5 }), /same 2\.5 kWh for eight readings/);
  assert.match(explainAnomaly("spike", row), /above/);
});

test("anomalies keep the contract's shape and drop unknown kinds", async () => {
  const db = fakeDb(() => [
    { meter_id: "RO-DB-004512", region: "dobrogea", county: "Constanța", kind: "consumption_drop", score: 4.7, at: new Date("2026-11-14T10:00:00Z"), kwh: 0.4, baseline_kwh: 1.9, voltage: 230 },
    { meter_id: "X", kind: "mystery", score: 1, at: new Date(), kwh: 1, baseline_kwh: 1, voltage: 230 },
  ]);
  const out = await listAnomalies(db, "dobrogea");
  assert.equal(out.length, 1);
  assert.deepEqual([out[0]?.meterId, out[0]?.region, out[0]?.county, out[0]?.kind, out[0]?.score, out[0]?.at], ["RO-DB-004512", "dobrogea", "Constanța", "consumption_drop", 4.7, "2026-11-14T10:00:00.000Z"]);
  assert.deepEqual(db.calls[0]?.params, ["dobrogea", 50]);
});

test("with no data yet, both lists are empty arrays of the right shape", async () => {
  assert.deepEqual(await listAnomalies(fakeDb()), []);
  assert.deepEqual(await listHotspots(fakeDb()), []);
});

test("hotspots carry coordinates only when the county is known", async () => {
  const out = await listHotspots(fakeDb(() => [
    { county: "Timiș", region: "banat", lat: 45.75, lon: 21.23, outages: 14, total_minutes: 412 },
    { county: "Not recorded", region: "muntenia", lat: null, lon: null, outages: 224, total_minutes: 0 },
  ]));
  assert.deepEqual(out[0], { county: "Timiș", region: "banat", lat: 45.75, lon: 21.23, outages: 14, totalMinutes: 412 });
  assert.equal("lat" in (out[1] ?? {}), false);
});

test("view queries are capped and parameterised", async () => {
  const db = fakeDb();
  await queryView(db, "alert_history", { days: 9999, limit: 9999 });
  assert.deepEqual(db.calls[0]?.params, ["60", 50]);
});
