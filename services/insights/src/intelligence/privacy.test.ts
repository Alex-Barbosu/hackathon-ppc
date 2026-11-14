import assert from "node:assert/strict";
import { test } from "node:test";
import { alertFacts, isCategory, scrub } from "./privacy.js";

test("scrub removes ids, emails, file names, national ID numbers and tokens", () => {
  const out = scrub("Upload passport-ion-popescu.pdf by ion.popescu@example.ro id 9b1c6e2a-1111-4222-8333-444455556666 CNP 1850101123456 token eyJhbGciOi.eyJzdWIi.abc123");
  assert.doesNotMatch(out, /popescu|\.pdf|@|9b1c6e2a|1850101123456|eyJ/);
  assert.match(out, /\[file\]/);
});

test("scrub leaves ordinary metric text and small numbers alone", () => {
  assert.equal(scrub("outage p95 212 ms, queue 4 items, 0.8% errors"), "outage p95 212 ms, queue 4 items, 0.8% errors");
});

test("alert facts keep only allowlisted labels with safe values", () => {
  const facts = alertFacts({
    alertname: "StorageDown", status: "firing", startsAt: "2026-11-14T12:41:00Z",
    labels: { alertname: "StorageDown", storage: "s3", severity: "critical", file: "secret.pdf", category: 'outage"} or vector(1) #', user: "ion" },
    annotations: { summary: "S3 is down for ion.popescu@example.ro", description: "see 9b1c6e2a-1111-4222-8333-444455556666" },
  });
  assert.deepEqual(facts.labels, { alertname: "StorageDown", storage: "s3", severity: "critical" });
  assert.doesNotMatch(JSON.stringify(facts), /popescu|9b1c6e2a|secret|vector/);
});

test("an alert name that is not identifier-shaped is not forwarded", () => {
  assert.equal(alertFacts({ alertname: "Down for Ion Popescu", status: "firing", startsAt: "x", labels: {}, annotations: {} }).alert, "UnknownAlert");
});

test("category guard rejects PromQL injection", () => {
  assert.equal(isCategory("outage"), true);
  assert.equal(isCategory('outage"} or vector(1) #'), false);
});
