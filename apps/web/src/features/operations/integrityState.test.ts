import assert from "node:assert/strict";
import { test } from "node:test";
import { integrityState } from "./integrityState.ts";

test("no API counter: no-api, even when the simulator reports plenty of acks", () => {
  assert.deepEqual(integrityState(645, undefined, undefined), { kind: "no-api", acked: 645 });
  assert.deepEqual(integrityState(null, undefined, 3), { kind: "no-api", acked: null });
});

test("equal windows use the equal state, with duplicates rejected", () => {
  assert.deepEqual(integrityState(600, 600, 7), { kind: "equal", acked: 600, stored: 600, duplicates: 7 });
});

test("increase() is fractional: whole readings are compared, so 599.6 and 600.4 are equal", () => {
  assert.deepEqual(integrityState(599.6, 600.4, 0.2), { kind: "equal", acked: 600, stored: 600, duplicates: 0 });
});

test("a missing duplicate series means zero duplicates once the API has counted readings", () => {
  assert.deepEqual(integrityState(10, 10, undefined), { kind: "equal", acked: 10, stored: 10, duplicates: 0 });
});

test("a real gap is never shown as equal, in either direction", () => {
  assert.equal(integrityState(600, 580, 0).kind, "differs");
  assert.equal(integrityState(580, 600, 0).kind, "differs");
});

test("an API window of zero is a real value, not a missing one", () => {
  assert.deepEqual(integrityState(5, 0, undefined), { kind: "differs", acked: 5, stored: 0, duplicates: 0 });
});

// A restart makes lifetime totals disagree (the restarted service starts again from zero) while
// the window, built from increase(), still agrees. This is the shape the card now receives.
test("after an API restart the lifetime totals would differ but the windowed values do not", () => {
  const lifetime = { acked: 4000, stored: 300 };
  const window10m = { acked: 600, stored: 600 };
  assert.equal(integrityState(lifetime.acked, lifetime.stored, 0).kind, "differs");
  assert.equal(integrityState(window10m.acked, window10m.stored, 0).kind, "equal");
});
