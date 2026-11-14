import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp, type MetersApi } from "../src/app.js";
import { authorizeAdmin, mintJwt, verifyJwt } from "../src/auth.js";
import { demux, type DockerApi, type ExecResult } from "../src/docker.js";
import type { RateState } from "../src/meters.js";
import { Storages, type Filer } from "../src/storages.js";
import { conditionFrom, toxicsFor, type NetworkCondition, type ToxiproxyApi } from "../src/toxiproxy.js";

const SECRET = "x".repeat(40);
const admin = `Bearer ${mintJwt(SECRET, "admin", "admin", 3600)}`;
const ID = "6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60";

test("JWT: admin passes; other roles, bad signatures, alg none and expired tokens do not", () => {
  assert.equal(authorizeAdmin(admin, SECRET).ok, true);
  const dispatch = authorizeAdmin(`Bearer ${mintJwt(SECRET, "dispatch", "dispatch", 3600)}`, SECRET);
  assert.deepEqual(dispatch.ok ? 0 : dispatch.status, 403);
  const forged = mintJwt("y".repeat(40), "admin", "admin", 3600);
  assert.equal(verifyJwt(forged, SECRET), undefined);
  const [, payload] = mintJwt(SECRET, "admin", "admin", 3600).split(".");
  const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${payload}.`;
  assert.equal(verifyJwt(none, SECRET), undefined);
  assert.equal(verifyJwt(mintJwt(SECRET, "admin", "admin", 10, 1000), SECRET, 2000), undefined);
  const missing = authorizeAdmin(undefined, SECRET);
  assert.equal(missing.ok ? 0 : missing.status, 401);
});

test("network conditions map to toxics and back", () => {
  const c: NetworkCondition = { target: "client", latencyMs: 300, jitterMs: 50, lossPct: 10, bandwidthKbps: 512 };
  const toxics = toxicsFor(c);
  assert.deepEqual(toxics.map((t) => t.name).sort(), ["fg_bandwidth_downstream", "fg_bandwidth_upstream", "fg_latency_downstream", "fg_latency_upstream", "fg_loss"]);
  assert.equal(toxics.find((t) => t.name === "fg_bandwidth_upstream")?.attributes.rate, 64, "512 kbit/s = 64 KB/s");
  assert.deepEqual(conditionFrom("client", toxics), c);
  assert.deepEqual(toxicsFor({ target: "db" }), [], "zeros clear");
  assert.equal(conditionFrom("db", [{ name: "other", type: "latency", stream: "upstream", toxicity: 1, attributes: {} }]), undefined);
});

test("docker exec output is demultiplexed", () => {
  const frame = (stream: number, s: string): Buffer => {
    const body = Buffer.from(s);
    const h = Buffer.alloc(8);
    h[0] = stream;
    h.writeUInt32BE(body.length, 4);
    return Buffer.concat([h, body]);
  };
  assert.deepEqual(demux(Buffer.concat([frame(1, "out1 "), frame(2, "err"), frame(1, "out2")])), { stdout: "out1 out2", stderr: "err" });
});

class FakeDocker implements DockerApi {
  running: Record<string, boolean> = { postgres: true, seaweedfs: true, ftp: true };
  execs: string[][] = [];
  rows: Record<string, string> = {};
  async findService(service: string) {
    return service in this.running ? { id: `id-${service}`, service, running: this.running[service] ?? false } : undefined;
  }
  async stop(id: string) {
    this.running[id.slice(3)] = false;
  }
  async start(id: string) {
    this.running[id.slice(3)] = true;
  }
  async exec(_id: string, cmd: string[]): Promise<ExecResult> {
    this.execs.push(cmd);
    // ["sh", "-c", script, "sh", sql, id]: $0 is "sh", $1 the SQL, $2 the id.
    const sql = cmd[4] ?? "";
    const id = cmd[5] ?? "";
    if (sql.startsWith("select")) return { exitCode: 0, stdout: this.rows[id] ?? "", stderr: "" };
    if (sql.startsWith("update")) return { exitCode: 0, stdout: "512\n", stderr: "" };
    return { exitCode: 0, stdout: "1000\n", stderr: "" }; // ftp flip
  }
}

class FakeToxi implements ToxiproxyApi {
  applied: NetworkCondition[] = [];
  resets = 0;
  async apply(c: NetworkCondition) {
    this.applied = this.applied.filter((x) => x.target !== c.target);
    if (toxicsFor(c).length) this.applied.push(c);
  }
  async conditions() {
    return this.applied;
  }
  async reset() {
    this.resets++;
    this.applied = [];
  }
}

class FakeMeters implements MetersApi {
  r: RateState = { profile: "normal", baseReadingsPerSec: 2, readingsPerSec: 2 };
  async rate() {
    return this.r;
  }
  async set(c: { readingsPerSec?: number; profile?: "normal" | "peak" }) {
    const base = c.readingsPerSec ?? this.r.baseReadingsPerSec;
    const profile = c.profile ?? this.r.profile;
    this.r = { profile, baseReadingsPerSec: base, readingsPerSec: base * (profile === "peak" ? 10 : 1) };
    return this.r;
  }
  async getBaseRate() {
    return this.r.baseReadingsPerSec;
  }
  async setBaseRate(n: number) {
    await this.set({ readingsPerSec: n });
  }
}

function setup() {
  const docker = new FakeDocker();
  const filer: Filer = { flipByte: async () => 4242 };
  const toxi = new FakeToxi();
  const meters = new FakeMeters();
  const { app, storms } = buildApp({ jwtSecret: SECRET, storages: new Storages(docker, filer), toxiproxy: toxi, meters, defaultReadingsPerSec: 1, apiUrl: "http://unused", logger: false });
  return { app, storms, docker, toxi, meters };
}

test("every /chaos route needs an admin token; health does not", async () => {
  const { app } = setup();
  assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/chaos/state" })).statusCode, 401);
  const dispatch = `Bearer ${mintJwt(SECRET, "dispatch", "dispatch", 3600)}`;
  assert.equal((await app.inject({ method: "POST", url: "/chaos/storages/s3/stop", headers: { authorization: dispatch } })).statusCode, 403);
  const res = await app.inject({ url: "/chaos/state", headers: { authorization: admin } });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { storages: Record<string, string>; network: unknown[]; meters: { readingsPerSec: number } };
  assert.deepEqual(body.storages, { db: "running", s3: "running", ftp: "running" });
  assert.deepEqual(body.network, []);
  assert.equal(body.meters.readingsPerSec, 2);
});

test("stop/start a storage, degrade the network, set meters, reset", async () => {
  const { app, docker, toxi, meters } = setup();
  const post = (url: string, payload?: object) => app.inject({ method: "POST", url, headers: { authorization: admin }, ...(payload ? { payload } : {}) });
  const emptyJson = await app.inject({ method: "POST", url: "/chaos/storages/ftp/stop", headers: { authorization: admin, "content-type": "application/json" } });
  assert.equal(emptyJson.statusCode, 202, "empty body with a JSON content type is fine");
  await post("/chaos/storages/ftp/start");
  const broken = await app.inject({ method: "POST", url: "/chaos/network", headers: { authorization: admin, "content-type": "application/json" }, payload: "{oops" });
  assert.equal(broken.statusCode, 400);
  assert.equal((await post("/chaos/network")).statusCode, 400, "network needs a body");
  let res = await post("/chaos/storages/s3/stop");
  assert.equal(res.statusCode, 202);
  assert.equal(docker.running.seaweedfs, false);
  assert.equal((res.json() as { storages: Record<string, string> }).storages.s3, "stopped");
  assert.equal((await post("/chaos/storages/redis/stop")).statusCode, 400, "only db, s3, ftp");
  res = await post("/chaos/network", { target: "client", latencyMs: 300, lossPct: 5 });
  assert.equal(res.statusCode, 202);
  assert.equal(toxi.applied.length, 1);
  assert.equal((await post("/chaos/network", { target: "x" })).statusCode, 400);
  res = await post("/chaos/meters", { readingsPerSec: 40 });
  assert.equal((res.json() as { meters: { readingsPerSec: number } }).meters.readingsPerSec, 40);
  res = await post("/chaos/reset");
  assert.equal(res.statusCode, 202);
  assert.equal(docker.running.seaweedfs, true);
  assert.equal(toxi.resets, 1);
  assert.deepEqual(meters.r, { profile: "normal", baseReadingsPerSec: 1, readingsPerSec: 1 });
  const log = (res.json() as { log: { action: string }[] }).log.map((l) => l.action);
  assert.deepEqual(log, ["reset", "meters 40/s", "degrade client: 300ms, 5% loss", "stop s3", "start ftp", "stop ftp"]);
});

test("corrupt: validates the id, routes by storage, refuses unknown files and stopped storages", async () => {
  const { app, docker } = setup();
  const corrupt = (fileId: string) => app.inject({ method: "POST", url: "/chaos/corrupt", headers: { authorization: admin }, payload: { fileId } });
  assert.equal((await corrupt("1; drop table files")).statusCode, 400);
  assert.equal((await corrupt(ID)).statusCode, 404);
  docker.rows[ID] = "s3|filegrid-outage/" + ID + "|200000";
  let res = await corrupt(ID);
  assert.equal(res.statusCode, 202);
  assert.match((res.json() as { log: { action: string }[] }).log[0]?.action ?? "", /in s3 at byte 4242/);
  docker.rows[ID] = `db|${ID}|1024`;
  assert.equal((await corrupt(ID)).statusCode, 202);
  docker.rows[ID] = `ftp|${ID}|2000`;
  assert.equal((await corrupt(ID)).statusCode, 202);
  const ftpExec = docker.execs.at(-1) ?? [];
  assert.equal(ftpExec.at(-1), ID, "the key is passed as an argument, never spliced into the script");
  docker.rows[ID] = "ftp|../../etc/passwd|1";
  assert.equal((await corrupt(ID)).statusCode, 409);
  docker.running.ftp = false;
  docker.rows[ID] = `ftp|${ID}|2000`;
  assert.equal((await corrupt(ID)).statusCode, 409);
  // The id reaches psql only as a variable.
  const lookups = docker.execs.filter((c) => (c[4] ?? "").startsWith("select"));
  assert.ok(lookups.length > 0);
  for (const cmd of lookups) assert.equal(cmd[5], ID);
});

test("meter storm multiplies the simulator rate and restores it; video storms are refused", async () => {
  const { app, storms, meters } = setup();
  const res = await app.inject({ method: "POST", url: "/chaos/storm", headers: { authorization: admin }, payload: { category: "meter", multiplier: 10, durationSec: 60 } });
  assert.equal(res.statusCode, 202);
  assert.equal(meters.r.baseReadingsPerSec, 20);
  assert.equal((res.json() as { storm: { category: string } }).storm.category, "meter");
  await storms.stop();
  assert.equal(meters.r.baseReadingsPerSec, 2);
  const video = await app.inject({ method: "POST", url: "/chaos/storm", headers: { authorization: admin }, payload: { category: "video", multiplier: 10, durationSec: 60 } });
  assert.equal(video.statusCode, 409);
});

test("outage storm uploads at baseline x multiplier with the caller's token", async () => {
  const seen: { auth: string | null; category: FormDataEntryValue | null }[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    seen.push({ auth: new Headers(init?.headers).get("authorization"), category: form.get("category") });
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  const { app, storms } = buildApp({
    jwtSecret: SECRET,
    storages: new Storages(new FakeDocker(), { flipByte: async () => 0 }),
    toxiproxy: new FakeToxi(),
    meters: new FakeMeters(),
    defaultReadingsPerSec: 1,
    apiUrl: "http://api/files",
    fetchFn,
    logger: false,
  });
  await app.inject({ method: "POST", url: "/chaos/storm", headers: { authorization: admin }, payload: { category: "outage", multiplier: 10, durationSec: 10 } });
  await new Promise((r) => setTimeout(r, 1100));
  await storms.stop();
  // 0.5/s x 10 = 5 uploads per second.
  assert.ok(seen.length >= 4 && seen.length <= 6, `${seen.length} uploads`);
  assert.ok(seen.every((s) => s.auth === admin && s.category === "outage"));
});

test("network targets: every proxy chaos-control degrades exists in the Toxiproxy seed", async () => {
  // A name missing from infra/toxiproxy/toxiproxy.json would make POST /chaos/network fail
  // with a 404 from Toxiproxy at demo time; for ftp it would leave transfers fast.
  const { readFile } = await import("node:fs/promises");
  const { PROXY_FOR, FTP_PASV_PORTS } = await import("../src/toxiproxy.js");
  const seed = JSON.parse(await readFile(new URL("../../../infra/toxiproxy/toxiproxy.json", import.meta.url), "utf8")) as { name: string; listen: string; upstream: string }[];
  const byName = new Map(seed.map((p) => [p.name, p]));
  for (const proxies of Object.values(PROXY_FOR)) for (const name of proxies) assert.ok(byName.has(name), `missing proxy ${name}`);
  // Passive ports are proxied one to one: vsftpd announces port N, the client dials toxiproxy:N.
  for (const port of FTP_PASV_PORTS) {
    const p = byName.get(`ftp_pasv_${port}`);
    assert.equal(p?.listen, `0.0.0.0:${port}`);
    assert.equal(p?.upstream, `ftp:${port}`);
  }
});
