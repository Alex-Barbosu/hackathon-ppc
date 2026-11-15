import assert from "node:assert/strict";
import { test } from "node:test";
import { accessFor } from "./permissions.ts";

test("each operational role uploads only its own category", () => {
  assert.deepEqual(accessFor("field").upload, ["video"]);
  assert.deepEqual(accessFor("dispatch").upload, ["outage"]);
  assert.deepEqual(accessFor("connections").upload, ["document"]);
});

test("only admin sees chaos and Storage Lab", () => {
  for (const r of ["field", "dispatch", "connections"]) {
    assert.equal(accessFor(r).chaos, false);
    assert.equal(accessFor(r).pages.includes("/lab"), false);
  }
  assert.equal(accessFor("admin").chaos, true);
});

test("an unknown role sees nothing", () => {
  assert.deepEqual(accessFor("intruder").pages, []);
  assert.deepEqual(accessFor(undefined).upload, []);
});
