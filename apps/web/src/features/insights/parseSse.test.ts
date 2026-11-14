import assert from "node:assert/strict";
import { test } from "node:test";
import { createSseParser } from "./parseSse.ts";

test("whole events parse in order", () => {
  const parse = createSseParser();
  const out = parse('data: {"type":"thinking","text":"a"}\n\ndata: {"type":"done"}\n\n');
  assert.deepEqual(out.map((e) => e.type), ["thinking", "done"]);
});

test("an event split across chunks is held until it is complete", () => {
  const parse = createSseParser();
  assert.deepEqual(parse('data: {"type":"te'), []);
  assert.deepEqual(parse('xt","text":"Outage p95 was 212 ms"}'), []);
  assert.deepEqual(parse("\n\n"), [{ type: "text", text: "Outage p95 was 212 ms" }]);
});

test("malformed and non-event blocks are skipped without losing the next one", () => {
  const parse = createSseParser();
  const out = parse('data: {oops\n\n: keep-alive\n\ndata: {"nope":1}\n\ndata: {"type":"done"}\n\n');
  assert.deepEqual(out, [{ type: "done" }]);
});

test("text with newlines and unicode survives the JSON round trip", () => {
  const parse = createSseParser();
  const out = parse(`data: ${JSON.stringify({ type: "text", text: "line one\n\nConstanța ≠ 600" })}\n\n`);
  assert.equal(out[0]?.text, "line one\n\nConstanța ≠ 600");
});
