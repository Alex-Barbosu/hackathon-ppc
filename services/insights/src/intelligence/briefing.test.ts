import assert from "node:assert/strict";
import { test } from "node:test";
import { BriefingService, deterministicBriefing, gatherFacts, groundBriefing, TITLES, type BriefingDeps } from "./briefing.js";
import { fakeDb, fakeLlm, fakeProm, textMessage } from "./testkit.js";

const FROM = new Date("2026-11-14T08:00:00Z"), TO = new Date("2026-11-14T10:00:00Z"), NOW = new Date("2026-11-14T10:05:00Z");
const lab = { latestRun: async () => ({ recommendation: [{ category: "document", storage: "ftp", reason: "S3 was faster for documents, but documents stay on FTPS.", evidence: [{ label: "write p95", value: "189 ms" }] }] }) };
const deps = (over: Partial<BriefingDeps> = {}): BriefingDeps => ({
  db: fakeDb(), prom: fakeProm([], [{ labels: { category: "outage" }, last: 3, min: 0, max: 5, avg: 1.5, points: 120 }]), lab, llm: null, model: "claude-haiku-5-5", now: () => NOW, ...over,
});
const good = JSON.stringify({ summary: "Keep documents on FTPS.", sections: TITLES.map((t) => ({ title: t, body: "Body.", metrics: [{ label: "documents: 95% saved within", value: "189 ms" }, { label: "invented", value: "999" }] })) });

test("facts come in three groups with the exact section titles, from measured data", async () => {
  const groups = await gatherFacts(deps(), FROM, TO);
  assert.deepEqual(groups.map((g) => g.title), [...TITLES]);
  assert.ok(groups[0]!.facts.some((f) => f.label === "documents: recommended storage" && f.value === "FTPS"));
  assert.ok(groups[1]!.facts.some((f) => f.label === "outage records: files saved per second, busiest minute" && f.value === "5.0"));
  assert.match(groups[2]!.notes.join(" "), /No meter anomalies/);
});

test("when sources are down the facts still build, and say what is missing", async () => {
  const broken = deps({ prom: { instant: async () => { throw new Error("down"); }, range: async () => { throw new Error("down"); } }, db: { query: async () => { throw new Error("down"); } }, lab: { latestRun: async () => { throw new Error("down"); } } });
  const groups = await gatherFacts(broken, FROM, TO);
  assert.equal(groups.length, 3);
  assert.match(groups[0]!.notes.join(" "), /No Storage Lab benchmark/);
});

test("metrics the model invented are dropped, exact copies are kept", async () => {
  const groups = await gatherFacts(deps(), FROM, TO);
  const b = groundBriefing(JSON.parse(good), groups, NOW)!;
  assert.deepEqual(b.sections[0]?.metrics, [{ label: "documents: 95% saved within", value: "189 ms" }]);
  assert.equal(groundBriefing({ nope: 1 }, groups, NOW), null);
});

test("the deterministic briefing has the same shape and says it is not AI", async () => {
  const b = deterministicBriefing(await gatherFacts(deps(), FROM, TO), NOW);
  assert.deepEqual(b.sections.map((s) => s.title), [...TITLES]);
  assert.match(b.summary, /without AI/);
});

test("an AI briefing is stored; the next request within 30 minutes is served from cache without another call", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const db = fakeDb((sql, p) => {
    if (sql.startsWith("INSERT INTO insights.briefings")) { rows[0] = { body: JSON.parse(String(p[4])), generated_at: NOW, ai: true }; return []; }
    return sql.includes("FROM insights.briefings") ? rows : [];
  });
  const llm = fakeLlm([textMessage(good)]);
  const svc = new BriefingService(deps({ db, llm }));
  const first = await svc.get(FROM, TO);
  assert.equal(first.cached, false);
  assert.equal(first.sections[0]?.metrics.length, 1);
  const again = await new BriefingService(deps({ db, llm })).get(FROM, TO);
  assert.equal(again.cached, true);
  assert.equal(llm.requests.length, 1);
  assert.equal(llm.requests[0]!.model, "claude-haiku-5-5");
});

test("when the AI fails the last written briefing is served and marked cached; with none, the plain one", async () => {
  const old = { summary: "Old but written.", sections: [], generatedAt: "2026-11-14T06:00:00.000Z" };
  const withCache = fakeDb((sql) => (sql.includes("FROM insights.briefings") ? [{ body: old, generated_at: new Date("2026-11-14T06:00:00Z"), ai: true }] : []));
  const stale = await new BriefingService(deps({ db: withCache, llm: fakeLlm([new Error("529")]) })).get(FROM, TO);
  assert.deepEqual([stale.summary, stale.cached], ["Old but written.", true]);
  const plain = await new BriefingService(deps({ llm: fakeLlm([new Error("529")]) })).get(FROM, TO);
  assert.deepEqual([plain.cached, /without AI/.test(plain.summary)], [false, true]);
});

test("simultaneous requests for the same period share one model call", async () => {
  const llm = fakeLlm([textMessage(good), textMessage(good)]);
  const svc = new BriefingService(deps({ llm }));
  await Promise.all([svc.get(FROM, TO), svc.get(FROM, TO), svc.get(FROM, TO)]);
  assert.equal(llm.requests.length, 1);
});
