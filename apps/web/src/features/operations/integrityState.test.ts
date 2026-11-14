import assert from "node:assert/strict";
import { test } from "node:test";
import { integrityState } from "./integrityState.ts";

test("no API counter: no-api, even when the simulator reports plenty of acks", () => {
  assert.deepEqual(integrityState(645, undefined, undefined), { kind: "no-api", sent: 645 });
  assert.deepEqual(integrityState(null, undefined, 3), { kind: "no-api", sent: null });
});

test("equal counts use the equal state, with duplicates rejected", () => {
  assert.deepEqual(integrityState(1200, 1200, 7), { kind: "equal", sent: 1200, stored: 1200, duplicates: 7 });
});

test("a missing duplicate series means zero duplicates once the API has counted readings", () => {
  assert.deepEqual(integrityState(10, 10, undefined), { kind: "equal", sent: 10, stored: 10, duplicates: 0 });
});

test("different counts are never shown as equal, in either direction", () => {
  assert.equal(integrityState(1203, 1200, 0).kind, "differs");
  assert.equal(integrityState(1200, 1203, 0).kind, "differs");
});

test("an API counter of zero is a real value, not a missing one", () => {
  assert.deepEqual(integrityState(5, 0, undefined), { kind: "differs", sent: 5, stored: 0, duplicates: 0 });
});

test("counters are compared as whole readings", () => {
  assert.equal(integrityState(100.0000001, 100, 0).kind, "equal");
});
