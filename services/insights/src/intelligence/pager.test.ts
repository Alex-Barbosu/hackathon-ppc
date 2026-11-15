import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { ntfyFromEnv, parseAck, listenAcks, type Fetch } from "./ntfy.js";
import { Pager, gridText, pagerConfigFromEnv, platformText, routesFor } from "./pager.js";
import { registerPager } from "./pagerRoutes.js";
import { fakeDb } from "./testkit.js";
import type { Row } from "./db.js";

const NTFY = { url: "https://ntfy.example", topic: "filegrid-test-topic-123" };
const cfg = (ntfy = true) => ({ holdSec: 60, gridThreshold: 5, publicUrl: "https://filegrid.lan", ntfy: ntfy ? NTFY : null });

function fakeFetch(status = 200): Fetch & { sent: Array<{ url: string; body: Record<string, unknown> }> } {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response("{}", { status });
  }) as Fetch & { sent: typeof sent };
  f.sent = sent;
  return f;
}

const ALERT: Row = { id: 7, alertname: "StorageDown", starts_at: new Date(Date.now() - 120_000), annotations: { summary: "s3 storage is down", description: "rule text" }, narration: "Outage records may be delayed. Restart S3." };
const PAGE: Row = { id: 1, route: "platform", on_call: "Admin on-call", topic: `${NTFY.topic}-admin`, title: "s3 storage is down", message: "m", link: "/operations", ack_token: "a".repeat(32), delivery: "pending", created_at: new Date() };

test("a data-loss alert past its hold time pages the admin with the narration and an Acknowledge button", async () => {
  const f = fakeFetch();
  const db = fakeDb((sql) => (sql.includes("FROM insights.alerts a") && sql.startsWith("SELECT") ? [ALERT] : sql.includes("INSERT INTO insights.pages") ? [PAGE] : []));
  const pages: string[] = [];
  await new Pager({ db, cfg: cfg(), fetch: f, onPage: (r) => pages.push(r) }).tick();
  const insert = db.calls.find((c) => c.sql.includes("INSERT INTO insights.pages"))!;
  assert.deepEqual(insert.params.slice(0, 4), ["platform", "alert:7", "Admin on-call", `${NTFY.topic}-admin`]);
  assert.match(String(insert.params[5]), /Restart S3/);
  assert.deepEqual(pages, ["platform"]);
  const push = f.sent[0]!.body as { priority: number; click: string; actions: Array<{ label: string; url: string; body?: string }> };
  assert.equal(push.priority, 5);
  assert.equal(push.click, "https://filegrid.lan/operations");
  assert.equal(push.actions[0]?.url, `${NTFY.url}/${NTFY.topic}-ack`);
  assert.equal(push.actions[0]?.body, `ack:1:${"a".repeat(32)}`);
  assert.ok(db.calls.some((c) => c.sql.includes("delivery = 'sent'")));
  // The hold is enforced in SQL against the alert's start, and only paging alerts are considered.
  const select = db.calls.find((c) => c.sql.includes("FROM insights.alerts a"))!;
  assert.deepEqual(select.params, [["StorageDown", "IntegrityFailure", "MeterReadingLossRisk", "DocumentProtectionFailure"], 60]);
});

test("an already open page is not sent twice", async () => {
  const f = fakeFetch();
  const db = fakeDb((sql) => (sql.includes("FROM insights.alerts a") && sql.startsWith("SELECT") ? [ALERT] : []));
  await new Pager({ db, cfg: cfg(), fetch: f }).tick();
  assert.equal(f.sent.length, 0);
});

test("a failed push stays pending for a retry instead of being lost", async () => {
  const db = fakeDb((sql) => (sql.includes("FROM insights.alerts a") && sql.startsWith("SELECT") ? [ALERT] : sql.includes("INSERT INTO insights.pages") ? [PAGE] : []));
  await new Pager({ db, cfg: cfg(), fetch: fakeFetch(503) }).tick();
  assert.ok(db.calls.some((c) => c.sql.includes("attempts = attempts + 1, delivery = CASE")));
});

test("without a topic the page is recorded with delivery off and nothing leaves", async () => {
  const f = fakeFetch();
  const db = fakeDb((sql) => (sql.includes("FROM insights.alerts a") && sql.startsWith("SELECT") ? [ALERT] : sql.includes("INSERT INTO insights.pages") ? [{ ...PAGE, topic: null, delivery: "off" }] : []));
  await new Pager({ db, cfg: cfg(false), fetch: f }).tick();
  assert.equal(db.calls.find((c) => c.sql.includes("INSERT INTO insights.pages"))?.params[12], "off");
  assert.equal(f.sent.length, 0);
});

test("a county at the threshold pages that region's dispatch; under it, nobody", async () => {
  const db = fakeDb((sql) => (sql.includes("v_outage_bursts") ? [
    { county: "Constanța", region: "dobrogea", outages: 6, last_station: "Medgidia 110 kV" },
    { county: "Timiș", region: "banat", outages: 4, last_station: null },
  ] : []));
  await new Pager({ db, cfg: cfg(false) }).tick();
  const inserts = db.calls.filter((c) => c.sql.includes("INSERT INTO insights.pages"));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0]!.params.slice(0, 3), ["grid", "grid:Constanța", "Dispatch on-call, Dobrogea"]);
  // Bursts close only for counties with no outage at all in the window (hysteresis), so Timiș stays "active".
  const close = db.calls.find((c) => c.sql.includes("route = 'grid' AND resolved_at IS NULL"))!;
  assert.deepEqual(close.params, [["Constanța", "Timiș"]]);
});

test("page text carries counts and stations, never anything about files or people", () => {
  const g = gridText({ county: "Constanța", region: "dobrogea", outages: 6, last_station: "Medgidia" }, 5);
  assert.equal(g.title, "Outage burst in Constanța");
  assert.match(g.message, /6 outage records from Constanța \(Dobrogea\)/);
  const p = platformText({ ...ALERT, narration: null });
  assert.equal(p.title, "s3 storage is down");
  assert.match(p.message, /StorageDown firing for 2 min\.\nrule text/);
});

test("roles: admin owns both routes, dispatch the grid, everyone else nothing", () => {
  assert.deepEqual(routesFor("admin"), ["platform", "grid"]);
  assert.deepEqual(routesFor("dispatch"), ["grid"]);
  assert.deepEqual(routesFor("field"), []);
});

test("ntfy config: off without a topic, refuses a malformed one, trims the URL", () => {
  assert.equal(ntfyFromEnv({}), null);
  assert.equal(ntfyFromEnv({ NTFY_TOPIC: "bad topic/../" }), null);
  assert.deepEqual(ntfyFromEnv({ NTFY_TOPIC: "abc", NTFY_URL: "http://ntfy/" }), { url: "http://ntfy", topic: "abc" });
  assert.deepEqual(pagerConfigFromEnv({ PAGER_HOLD_SEC: "0", PAGER_GRID_THRESHOLD: "x" }, null), { holdSec: 0, gridThreshold: 5, publicUrl: "https://localhost", ntfy: null });
});

test("only a well-formed ack with a 32-hex token is accepted", () => {
  assert.deepEqual(parseAck(`ack:12:${"f".repeat(32)}`), { id: 12, token: "f".repeat(32) });
  assert.equal(parseAck("ack:12:short"), null);
  assert.equal(parseAck("hello"), null);
  assert.equal(parseAck(42), null);
});

test("the ack listener stores acks it reads from the topic stream", async () => {
  const stop = new AbortController();
  const got: number[] = [];
  const body = [JSON.stringify({ event: "open" }), JSON.stringify({ event: "message", id: "x1", message: `ack:3:${"b".repeat(32)}` }), JSON.stringify({ event: "message", id: "x2", message: "spam" })].join("\n") + "\n";
  const f = (async () => new Response(body)) as unknown as Fetch;
  await listenAcks(NTFY, async (a) => { got.push(a.id); stop.abort(); }, stop.signal, () => {}, f);
  assert.deepEqual(got, [3]);
});

test("a phone ack must carry the page's token", async () => {
  const db = fakeDb();
  await new Pager({ db, cfg: cfg(false) }).ackFromPhone(3, "c".repeat(32));
  assert.deepEqual(db.calls[0]!.params, [3, "c".repeat(32)]);
  assert.match(db.calls[0]!.sql, /ack_token = \$2 AND acked_at IS NULL/);
});

const SECRET = "s".repeat(40);
const token = (role: string) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256" }), p = b({ sub: role, role, exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};

test("the pages API: token required, field refused, dispatch filtered to grid, unknown page is 404", async () => {
  const db = fakeDb((sql) => (sql.startsWith("SELECT * FROM insights.pages WHERE route") ? [{ ...PAGE, route: "grid" }] : []));
  const a = Fastify();
  registerPager(a, new Pager({ db, cfg: cfg(false) }), SECRET);
  const auth = (r: string) => ({ authorization: `Bearer ${token(r)}` });
  assert.equal((await a.inject({ method: "GET", url: "/insights/pages" })).statusCode, 401);
  assert.equal((await a.inject({ method: "GET", url: "/insights/pages", headers: auth("field") })).statusCode, 403);
  const list = await a.inject({ method: "GET", url: "/insights/pages", headers: auth("dispatch") });
  assert.equal(list.statusCode, 200);
  assert.equal((list.json() as Array<{ route: string }>)[0]?.route, "grid");
  assert.ok(!list.body.includes("ack_token") && !list.body.includes("aaaa"), "the ack token never leaves the server");
  assert.deepEqual(db.calls.at(-1)?.params, [["grid"], 30]);
  assert.equal((await a.inject({ method: "POST", url: "/insights/pages/99/ack", headers: auth("dispatch") })).statusCode, 404);
  assert.equal((await a.inject({ method: "POST", url: "/insights/pages/x/ack", headers: auth("admin") })).statusCode, 404);
});

test("a storage the health probe sees down pages the admin in the same tick, once", async () => {
  const f = fakeFetch();
  const opened: unknown[][] = [];
  const db = fakeDb((sql, params) => {
    if (sql.includes("INSERT INTO insights.pages")) { opened.push(params); return [{ ...PAGE, storage: "s3" }]; }
    return [];
  });
  const pager = new Pager({ db, cfg: cfg(), fetch: f, storageHealth: async () => [{ storage: "db", up: true }, { storage: "s3", up: false }, { storage: "ftp", up: true }] });
  await pager.tick();
  assert.equal(opened.length, 1);
  assert.deepEqual([opened[0]![0], opened[0]![1], opened[0]![4], opened[0]![13]], ["platform", "storage:s3", "S3 (SeaweedFS) is down", "s3"]);
  assert.equal(f.sent.length, 1);
  // Storages that answer close their open probe pages.
  assert.deepEqual(db.calls.find((c) => c.sql.includes("open_key LIKE 'storage:%'"))?.params, [["db", "ftp"]]);
});

test("a storage already paged is not paged again, and a probe failure pages nobody", async () => {
  const db = fakeDb((sql) => (sql.includes("WHERE storage = $1 AND resolved_at IS NULL") ? [{ "?column?": 1 }] : []));
  await new Pager({ db, cfg: cfg(false), storageHealth: async () => [{ storage: "s3", up: false }] }).tick();
  assert.ok(!db.calls.some((c) => c.sql.includes("INSERT INTO insights.pages")));
  const db2 = fakeDb();
  await new Pager({ db: db2, cfg: cfg(false), storageHealth: async () => { throw new Error("api down"); } }).tick();
  assert.ok(!db2.calls.some((c) => c.sql.includes("INSERT INTO insights.pages")));
});

test("the StorageDown alert is skipped when the probe already paged that storage", async () => {
  const db = fakeDb();
  await new Pager({ db, cfg: cfg(false) }).tick();
  assert.match(db.calls.find((c) => c.sql.includes("FROM insights.alerts a"))!.sql, /a\.alertname = 'StorageDown' AND EXISTS/);
});

test("setup is admin only and shows the topics to subscribe", async () => {
  const a = Fastify();
  registerPager(a, new Pager({ db: fakeDb(), cfg: cfg() }), SECRET);
  const auth = (r: string) => ({ authorization: `Bearer ${token(r)}` });
  assert.equal((await a.inject({ method: "GET", url: "/insights/pages/setup", headers: auth("dispatch") })).statusCode, 403);
  const res = (await a.inject({ method: "GET", url: "/insights/pages/setup", headers: auth("admin") })).json() as { phone: boolean; topics: { admin: string; dispatch: Record<string, string> } };
  assert.equal(res.phone, true);
  assert.equal(res.topics.admin, `${NTFY.topic}-admin`);
  assert.equal(res.topics.dispatch.dobrogea, `${NTFY.topic}-dispatch-dobrogea`);
});
