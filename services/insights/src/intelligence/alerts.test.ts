import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { parseWebhook } from "./alertStore.js";
import { aiConfigFromEnv } from "./llm.js";
import { emptyKnowledge } from "./knowledge.js";
import { cameThroughGateway, registerIntelligence } from "./routes.js";
import { fakeDb, fakeProm } from "./testkit.js";

const SECRET = "s".repeat(40);
const token = (role: string) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256" }), p = b({ sub: "ana", role, exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const WEBHOOK = {
  version: "4", status: "firing", receiver: "insights",
  alerts: [{ status: "firing", labels: { alertname: "StorageDown", storage: "s3", severity: "critical" }, annotations: { summary: "S3 storage is down" }, startsAt: "2026-11-14T12:41:00Z", endsAt: "0001-01-01T00:00:00Z", fingerprint: "a1b2c3" }],
};

test("the contract's example webhook parses; a firing alert has no end", () => {
  const a = parseWebhook(WEBHOOK)!;
  assert.equal(a.length, 1);
  assert.deepEqual([a[0]?.alertname, a[0]?.status, a[0]?.severity, a[0]?.endsAt], ["StorageDown", "firing", "critical", null]);
});

test("a body that is not a webhook is refused", () => {
  assert.equal(parseWebhook({}), null);
  assert.equal(parseWebhook({ alerts: [{ status: "firing", labels: {}, startsAt: "2026-11-14T12:41:00Z" }] }), null);
  assert.equal(parseWebhook({ alerts: Array.from({ length: 51 }, () => WEBHOOK.alerts[0]) }), null);
  assert.equal(parseWebhook({ alerts: [{ ...WEBHOOK.alerts[0], startsAt: "not a date" }] }), null);
});

test("anything that came through the gateway is recognised", () => {
  assert.equal(cameThroughGateway({ "x-forwarded-for": "172.18.0.2" }), true);
  assert.equal(cameThroughGateway({ host: "insights:8070" }), false);
});

async function app() {
  const db = fakeDb((sql) => (sql.includes("RETURNING id") ? [{ id: 1, needs: true }] : sql.includes("FROM insights.alerts WHERE id") ? [{ id: 1, fingerprint: "a1b2c3", alertname: "StorageDown", status: "firing", severity: "critical", labels: {}, annotations: {}, starts_at: new Date(), ends_at: null, narration: null }] : []));
  const a = Fastify();
  registerIntelligence(a, { db, secret: SECRET, ai: aiConfigFromEnv({}), prom: fakeProm(), knowledge: emptyKnowledge, lab: { latest: async () => null } });
  return { a, db };
}

test("the alert webhook is internal only: direct is accepted, through the gateway is forbidden", async () => {
  const { a, db } = await app();
  const direct = await a.inject({ method: "POST", url: "/insights/alerts", payload: WEBHOOK });
  assert.equal(direct.statusCode, 202);
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO insights.alerts")));
  const viaGateway = await a.inject({ method: "POST", url: "/insights/alerts", payload: WEBHOOK, headers: { "x-forwarded-for": "10.0.0.9" } });
  assert.equal(viaGateway.statusCode, 403);
  assert.equal((await a.inject({ method: "POST", url: "/insights/alerts", payload: { nope: 1 } })).statusCode, 400);
});

test("every other intelligence endpoint needs a verified token", async () => {
  const { a } = await app();
  for (const [method, url] of [["GET", "/insights/incidents"], ["GET", "/insights/anomalies"], ["GET", "/insights/outage-hotspots"], ["GET", "/insights/briefing"], ["POST", "/insights/ask"]] as const) {
    assert.equal((await a.inject({ method, url, ...(method === "POST" ? { payload: { question: "hi" } } : {}) })).statusCode, 401, url);
  }
  assert.equal((await a.inject({ method: "GET", url: "/insights/incidents", headers: { authorization: `Bearer ${token("dispatch")}` } })).statusCode, 200);
  assert.equal((await a.inject({ method: "GET", url: "/insights/anomalies?region=mars", headers: { authorization: `Bearer ${token("dispatch")}` } })).statusCode, 400);
});

test("asking with no AI configured streams an explanation and finishes", async () => {
  const { a } = await app();
  const res = await a.inject({ method: "POST", url: "/insights/ask", payload: { question: "How did the storm compare?" }, headers: { authorization: `Bearer ${token("dispatch")}` } });
  assert.equal(res.headers["content-type"], "text/event-stream");
  const events = res.body.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string });
  assert.deepEqual(events.map((e) => e.type), ["error", "text", "done"]);
});
