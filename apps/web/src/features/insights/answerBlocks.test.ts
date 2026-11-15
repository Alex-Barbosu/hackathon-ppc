import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, parseBlocks } from "./answerBlocks.ts";

test("bold spans are found, stray asterisks stay literal", () => {
  assert.deepEqual(inline("p95 is **11 ms** now"), [{ text: "p95 is ", bold: false }, { text: "11 ms", bold: true }, { text: " now", bold: false }]);
  assert.deepEqual(inline("a * b"), [{ text: "a * b", bold: false }]);
});

test("paragraphs, bullets and numbered lists", () => {
  const b = parseBlocks("**Yes.** Meters are fine.\n\n- 1800 accepted\n- 0 duplicates\n\n1. Check S3\n2. Rerun");
  assert.equal(b.length, 3);
  assert.equal(b[0]!.kind, "p");
  assert.equal(b[1]!.kind === "ul" && b[1]!.items.length, 2);
  assert.equal(b[2]!.kind === "ol" && b[2]!.items.length, 2);
});

test("markup is never interpreted", () => {
  const b = parseBlocks("<img src=x onerror=alert(1)>");
  assert.equal(b[0]!.kind === "p" && b[0]!.parts[0]!.text, "<img src=x onerror=alert(1)>");
});

test("each line is its own paragraph, so the confidence line stands apart", () => {
  const b = parseBlocks("**Next step:** keep pools apart.\nConfidence: high");
  assert.equal(b.length, 2);
});
