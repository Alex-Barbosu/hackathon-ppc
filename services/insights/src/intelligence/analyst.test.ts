import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryConversations, runAnalyst, type AnalystEvent } from "./analyst.js";
import type { Briefing } from "./briefing.js";
import { BudgetExceeded } from "./llm.js";
import { emptyKnowledge } from "./knowledge.js";
import { fakeDb, fakeLlm, fakeProm, textMessage, toolMessage } from "./testkit.js";
import type { ToolContext } from "./tools.js";

const BRIEF: Briefing = { generatedAt: "2026-11-14T10:00:00.000Z", summary: "Keep documents on FTPS.", sections: [{ title: "Storage", body: "S3 was faster for documents.", metrics: [{ label: "documents write p95", value: "189 ms" }] }] };
const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  db: fakeDb(), prom: fakeProm([{ labels: { category: "outage" }, value: 212.4 }]), knowledge: emptyKnowledge, lab: async () => null, ...over,
});

async function ask(llm: ReturnType<typeof fakeLlm> | null, question = "How did the storm compare?", c: ToolContext = ctx(), conversations = new MemoryConversations(), cid?: string, fallback: Briefing | null = BRIEF) {
  const events: AnalystEvent[] = [];
  await runAnalyst({ llm, model: "claude-haiku-5-5", ctx: c, conversations, fallback: async () => fallback }, question, cid, (e) => events.push(e));
  return events;
}
const types = (e: AnalystEvent[]) => e.map((x) => x.type);

test("a question that needs a number is answered through a tool, with source chips", async () => {
  const llm = fakeLlm([toolMessage("query_prometheus", { promql: "sum by (category) (rate(filegrid_ops_total[5m]))" }), textMessage("Outage throughput was 212 ops/s. Confidence: high.")]);
  const events = await ask(llm);
  assert.deepEqual(types(events), ["thinking", "tool_call", "sources", "text", "done"]);
  assert.match(events.find((e) => e.type === "tool_call")?.text ?? "", /Querying Prometheus/);
  assert.deepEqual(events.find((e) => e.type === "sources")?.sources, [{ label: "category=outage", query: "sum by (category) (rate(filegrid_ops_total[5m]))", value: "212" }]);
  // The second request carries the tool result back to the model.
  const last = llm.requests[1]!.messages.at(-1)!;
  assert.equal(last.role, "user");
  assert.match(JSON.stringify(last.content), /tool_result.*212/);
});

test("the system prompt and the tool list are marked for caching, and the model is the configured one", async () => {
  const llm = fakeLlm([textMessage("Fine.")]);
  await ask(llm);
  const req = llm.requests[0]!;
  assert.equal(req.model, "claude-haiku-5-5");
  assert.deepEqual((req.system as Array<{ cache_control?: unknown }>)[0]?.cache_control, { type: "ephemeral" });
  const tools = req.tools as Array<{ name: string; cache_control?: unknown }>;
  assert.deepEqual(tools.map((t) => t.name), ["query_prometheus", "query_view", "get_storage_lab_result", "search_knowledge"]);
  assert.deepEqual(tools.at(-1)?.cache_control, { type: "ephemeral" });
  assert.equal(tools.filter((t) => t.cache_control).length, 1);
});

test("personal data typed into a question never reaches the model", async () => {
  const llm = fakeLlm([textMessage("OK.")]);
  await ask(llm, "Why was passport-ion-popescu.pdf from ion.popescu@example.ro (CNP 1850101123456) slow?");
  assert.doesNotMatch(JSON.stringify(llm.requests), /popescu|\.pdf|@example|1850101123456/);
});

test("with no AI configured the cached briefing is the answer", async () => {
  const events = await ask(null);
  assert.deepEqual(types(events), ["error", "text", "sources", "done"]);
  assert.match(events[1]?.text ?? "", /Keep documents on FTPS/);
  assert.deepEqual(events[2]?.sources?.[0], { label: "documents write p95", query: "cached briefing", value: "189 ms" });
});

test("an API error, a refusal and an exhausted budget all fall back to the briefing", async () => {
  for (const [script, expect] of [[[new Error("529 overloaded")], /could not answer/], [[new BudgetExceeded()], /budget/]] as const) {
    const events = await ask(fakeLlm([...script]));
    assert.equal(types(events)[0], "thinking");
    assert.ok(events.some((e) => e.type === "error" && expect.test(e.text ?? "")));
    assert.ok(events.some((e) => e.type === "text" && /Keep documents on FTPS/.test(e.text ?? "")));
    assert.equal(types(events).at(-1), "done");
  }
  const refusal = { ...textMessage(""), stop_reason: "refusal" } as ReturnType<typeof textMessage>;
  assert.ok(types(await ask(fakeLlm([refusal]))).includes("error"));
});

test("with no briefing either, the user is pointed at the live numbers", async () => {
  const events = await ask(null, "hi", ctx(), new MemoryConversations(), undefined, null);
  assert.match(events.find((e) => e.type === "text")?.text ?? "", /Operations page/);
});

test("a tool that fails reports the error to the model instead of crashing the loop", async () => {
  const c = ctx({ prom: { instant: async () => { throw new Error("parse error at char 3"); }, range: async () => [] } });
  const llm = fakeLlm([toolMessage("query_prometheus", { promql: "sum(" }), textMessage("I could not run that query.")]);
  const events = await ask(llm, "q", c);
  assert.equal(types(events).at(-1), "done");
  assert.match(JSON.stringify(llm.requests[1]!.messages.at(-1)), /is_error.*true/);
});

test("the loop is bounded: a model that never stops calling tools ends after six calls", async () => {
  const llm = fakeLlm(Array.from({ length: 10 }, (_, i) => toolMessage("get_storage_lab_result", {}, `tu_${i}`)));
  const events = await ask(llm);
  assert.equal(llm.requests.length, 6);
  assert.match(events.map((e) => e.text ?? "").join(""), /stopped after several lookups/);
  assert.equal(types(events).at(-1), "done");
});

test("a follow-up in the same conversation sees the earlier exchange, not the tool traffic", async () => {
  const convo = new MemoryConversations();
  await ask(fakeLlm([textMessage("Documents are on FTPS.")]), "Where do documents live?", ctx(), convo, "c1");
  const llm = fakeLlm([textMessage("Because of the audit trail.")]);
  await ask(llm, "Why?", ctx(), convo, "c1");
  assert.deepEqual(llm.requests[0]!.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(new MemoryConversations().history("never-seen").length, 0);
});

test("search_knowledge returns nothing until a corpus is plugged in, and says so", async () => {
  const llm = fakeLlm([toolMessage("search_knowledge", { query: "SAIDI" }), textMessage("I have no background notes on that.")]);
  await ask(llm);
  assert.match(JSON.stringify(llm.requests[1]!.messages.at(-1)), /No background notes are available/);
});
