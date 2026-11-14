import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Q } from "./prom.ts";

// The Prometheus version the stack runs (infra compose). promtool ships in the image, so the test
// exercises the real increase() with real counter-reset handling, using the card's own query strings.
const IMAGE = "prom/prometheus:v3.1.0";
const haveImage = spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0;

// 5 s scrapes for 10 minutes: 121 samples. "0+5x59 5+5x61" is a counter that climbs by 5 per scrape,
// restarts after sample 59 (back to 0) and keeps counting: a service restart in the middle of the window.
const STEADY = "0+5x120";
const RESTARTED = "0+5x59 5+5x61";
const SLOW = "0+4x120"; // the API stored 20% fewer readings than were acknowledged

const group = (acked: string, stored: string, expr: string, exp: number) => `
  - interval: 5s
    input_series:
      - { series: 'meter_sim_acked_total{result="accepted"}', values: '${acked}' }
      - { series: 'filegrid_meter_readings_total{result="accepted"}', values: '${stored}' }
      - { series: 'filegrid_meter_readings_total{result="duplicate"}', values: '0+1x120' }
    promql_expr_test:
      - expr: ${expr}
        eval_time: 10m
        exp_samples:
          - value: ${exp}
`;

const gap = `round(${Q.simAcked}) - round(${Q.storedAccepted})`;

function promtool(name: string, groups: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "promql-"));
  // promtool runs as an unprivileged user inside the container, so the mount must be world-readable.
  chmodSync(dir, 0o755);
  const file = join(dir, `${name}.yml`);
  writeFileSync(file, `evaluation_interval: 5s\ntests:${groups}`);
  chmodSync(file, 0o644);
  const r = spawnSync("docker", ["run", "--rm", "--entrypoint", "promtool", "-v", `${dir}:/t:ro`, IMAGE, "test", "rules", `/t/${name}.yml`], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("an API restart inside the window leaves acked and stored equal", { skip: !haveImage && "prometheus image not available" }, () => {
  const r = promtool("api-reset", group(STEADY, RESTARTED, gap, 0));
  assert.equal(r.status, 0, r.out);
});

test("a simulator restart inside the window leaves acked and stored equal", { skip: !haveImage && "prometheus image not available" }, () => {
  const r = promtool("sim-reset", group(RESTARTED, STEADY, gap, 0));
  assert.equal(r.status, 0, r.out);
});

test("a real gap is still a gap after rounding", { skip: !haveImage && "prometheus image not available" }, () => {
  const r = promtool("gap", group(STEADY, SLOW, `(${gap}) > bool 50`, 1));
  assert.equal(r.status, 0, r.out);
});

test("duplicates rejected come from the same window", { skip: !haveImage && "prometheus image not available" }, () => {
  const r = promtool("dups", group(STEADY, STEADY, `round(${Q.storedDuplicates})`, 120));
  assert.equal(r.status, 0, r.out);
});

test("sanity: the harness fails when the expectation is wrong", { skip: !haveImage && "prometheus image not available" }, () => {
  const r = promtool("wrong", group(STEADY, RESTARTED, gap, 7));
  assert.notEqual(r.status, 0);
  // It must fail on the expectation itself, not on a setup error.
  assert.match(r.out, /FAILED/);
  assert.match(r.out, /exp:.*7/s);
});

test("contrast: on the same restarted series the old lifetime totals disagree by what the restart wiped", { skip: !haveImage && "prometheus image not available" }, () => {
  const lifetime = 'sum(meter_sim_acked_total) - sum(filegrid_meter_readings_total{result="accepted"})';
  const r = promtool("lifetime", group(STEADY, RESTARTED, lifetime, 295));
  assert.equal(r.status, 0, r.out);
});
