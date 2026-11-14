import assert from "node:assert/strict";
import { test } from "node:test";
import { clockNote, recordingLine } from "./recording.ts";

test("only a guessed clock gets a note", () => {
  assert.match(clockNote("assumed-utc") ?? "", /read as UTC/);
  assert.equal(clockNote("offset"), null);
  assert.equal(clockNote("utc"), null);
  assert.equal(clockNote(undefined), null);
});

test("the recording line names the station and the fault time when the file gave them", () => {
  const fmt = (iso: string) => `<${iso}>`;
  assert.equal(recordingLine({ format: "comtrade", station: "Statia Deva", faultTime: "2026-11-13T18:00:00Z" }, fmt), "Statia Deva · fault <2026-11-13T18:00:00Z>");
  assert.equal(recordingLine({ format: "comtrade", station: "Statia Deva" }, fmt), "Statia Deva");
  assert.equal(recordingLine({ format: "comtrade" }, fmt), null);
});
