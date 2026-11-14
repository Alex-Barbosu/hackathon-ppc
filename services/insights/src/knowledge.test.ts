// Guards the corpus itself: every chunk must parse, cite a known source and be findable,
// because a malformed chunk would silently vanish from the analyst's answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCorpus, searchKnowledge } from "./knowledge.js";

const root = new URL("../corpus", import.meta.url).pathname;
const chunks = loadCorpus(root);
const sources = readFileSync(`${root}/SOURCES.md`, "utf8");

test("every chunk parses and cites a source listed in SOURCES.md", () => {
  assert.ok(chunks.length >= 10);
  for (const c of chunks) {
    assert.ok(c.source.length > 0, `${c.id} has no source`);
    for (const s of c.source) assert.ok(sources.includes(`\`${s}\``), `${c.id} cites unknown source ${s}`);
    assert.ok(c.answers.length > 0, `${c.id} answers no section 5 question`);
  }
});

test("reliability questions find the SAIDI material", () => {
  const hits = searchKnowledge(chunks, "how bad is SAIDI in Banat compared with Europe");
  assert.equal(hits[0]?.chunk.id, "romania-saidi-trend");
});

test("filter by section 5 question", () => {
  const hits = searchKnowledge(chunks, "storage latency", { answers: "storage-fit", limit: 10 });
  assert.ok(hits.length > 0 && hits.every((h) => h.chunk.answers.includes("storage-fit")));
});
