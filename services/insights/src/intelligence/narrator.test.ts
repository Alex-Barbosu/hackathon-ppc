import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredAlert } from "./alertStore.js";
import { BudgetExceeded } from "./llm.js";
import { narrateAlert, NARRATOR_SYSTEM, relatedMetrics, twoSentences } from "./narrator.js";
import { fakeDb, fakeLlm, fakeProm, textMessage } from "./testkit.js";

const alert = (over: Partial<StoredAlert> = {}): StoredAlert => ({
  id: 7, fingerprint: "fp", alertname: "StorageDown", status: "firing", severity: "critical", startsAt: "2026-11-14T12:41:00.000Z", endsAt: null, narration: null,
  labels: { alertname: "StorageDown", storage: "s3", severity: "critical", guarantee: "isolation" },
  annotations: { summary: "S3 storage is down", description: "filegrid_storage_up{storage=\"s3\"} == 0 for 30s" }, ...over,
});

test("two sentences at most, on one line, without markdown", () => {
  assert.equal(twoSentences("**S3 is down.**\nOutage records may be delayed. Restart S3. Then check the spool."), "S3 is down. Outage records may be delayed.");
  assert.equal(twoSentences("no punctuation here"), "no punctuation here");
});

test("the narration is written from metrics only and stored with the model that wrote it", async () => {
  const llm = fakeLlm([textMessage("Outage records may be delayed for dispatch. S3 stopped answering; restart it and the spool will drain.")]);
  const db = fakeDb();
  const prom = fakeProm([{ labels: {}, value: 0 }]);
  const text = await narrateAlert({ db, llm, model: "claude-haiku-5-5", prom }, alert());
  assert.match(text ?? "", /delayed for dispatch/);
  const req = llm.requests[0]!;
  assert.equal(req.model, "claude-haiku-5-5");
  assert.equal((req.system as Array<{ text: string }>)[0]?.text, NARRATOR_SYSTEM);
  const save = db.calls.find((c) => c.sql.includes("SET narration"));
  assert.deepEqual(save?.params.slice(0, 3), [7, text, "claude-haiku-5-5"]);
});

test("nothing personal reaches the model, even when the alert text carries it", async () => {
  const llm = fakeLlm([textMessage("Dispatch may be delayed. Check S3.")]);
  const dirty = alert({
    labels: { alertname: "StorageDown", storage: "s3", file: "passport-ion-popescu.pdf", user: "ion.popescu@example.ro" },
    annotations: { summary: "Upload of passport-ion-popescu.pdf failed for ion.popescu@example.ro", description: "id 9b1c6e2a-1111-4222-8333-444455556666 CNP 1850101123456" },
  });
  await narrateAlert({ db: fakeDb(), llm, model: "m", prom: fakeProm() }, dirty);
  const sent = JSON.stringify(llm.requests[0]);
  assert.doesNotMatch(sent, /popescu|\.pdf|@example|9b1c6e2a|1850101123456/);
});

test("related metrics are only asked for validated categories and storages", async () => {
  const prom = fakeProm([{ labels: {}, value: 0.2 }]);
  await relatedMetrics(prom, { category: 'outage"} or vector(1) #', storage: "s3; drop" });
  assert.deepEqual(prom.asked, []);
  const m = await relatedMetrics(prom, { category: "outage", storage: "s3" });
  assert.ok(m.length >= 4);
  assert.ok(!prom.asked.join("\n").includes("vector(1)"));
});

test("no key, an exhausted budget and an API error each leave a short code and no narration", async () => {
  const run = async (llm: ReturnType<typeof fakeLlm> | null) => {
    const db = fakeDb();
    const out = await narrateAlert({ db, llm, model: "m", prom: fakeProm() }, alert());
    return { out, code: db.calls.find((c) => c.sql.includes("narration_error"))?.params[1] };
  };
  assert.deepEqual(await run(null), { out: null, code: "no_key" });
  assert.deepEqual(await run(fakeLlm([new BudgetExceeded()])), { out: null, code: "budget" });
  assert.deepEqual(await run(fakeLlm([new Error("529 overloaded: secret detail")])), { out: null, code: "unavailable" });
  assert.deepEqual(await run(fakeLlm([textMessage("   ")])), { out: null, code: "empty" });
});
