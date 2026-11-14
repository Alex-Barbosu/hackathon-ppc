import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyKnowledge } from "./knowledge.js";
import { fakeDb, fakeProm } from "./testkit.js";
import { capText, runTool, TOOL_DEFS, type ToolContext } from "./tools.js";

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({ db: fakeDb(), prom: fakeProm(), knowledge: emptyKnowledge, lab: async () => null, ...over });

test("output is capped before it can enter the context", () => {
  const long = "x".repeat(10_000);
  assert.ok(capText(long).length < 3700);
  assert.match(capText(long), /truncated/);
  assert.equal(capText("short"), "short");
});

test("prometheus input is validated, and over-long queries are refused", async () => {
  assert.equal((await runTool(ctx(), "query_prometheus", {})).isError, true);
  assert.match((await runTool(ctx(), "query_prometheus", { promql: "x".repeat(501) })).text, /longer than 500/);
  assert.equal((await runTool(ctx(), "query_prometheus", "not an object")).isError, true);
});

test("a range query returns summaries with chips; an instant query returns the current value", async () => {
  const prom = fakeProm([{ labels: { category: "meter" }, value: 7.25 }], [{ labels: { category: "meter" }, last: 7, min: 6, max: 9, avg: 7.4, points: 40 }]);
  const range = await runTool(ctx({ prom }), "query_prometheus", { promql: "m", minutes: 60 });
  assert.deepEqual(range.sources[0], { label: "category=meter over 60 min", query: "m", value: "last 7.00, avg 7.40, max 9.00" });
  const now = await runTool(ctx({ prom }), "query_prometheus", { promql: "m" });
  assert.equal(now.sources[0]?.value, "7.25");
});

test("only allowlisted views can be read, and filters go in as parameters, never into the SQL", async () => {
  const db = fakeDb();
  assert.match((await runTool(ctx({ db }), "query_view", { view: "users; DROP TABLE files" })).text, /view must be one of/);
  assert.equal(db.calls.length, 0);
  await runTool(ctx({ db }), "query_view", { view: "files_daily", category: "outage' OR '1'='1", days: 3 });
  const call = db.calls[0]!;
  assert.ok(!call.sql.includes("OR '1'='1"));
  assert.ok(call.params.includes("outage' OR '1'='1"));
});

test("no tool exposes file names, contents or uploaders", () => {
  assert.doesNotMatch(JSON.stringify(TOOL_DEFS), /original_name|uploaded_by|content|file name/i);
});

test("an unknown tool name is an error, not a crash", async () => {
  assert.equal((await runTool(ctx(), "drop_database", {})).isError, true);
});
