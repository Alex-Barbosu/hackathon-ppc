// Zone B. Source of infra/grafana/dashboards/overview.json (FileGrid Overview).
// Edit here, then: make b-dashboards. Titles speak to a decision maker; descriptions name
// the metric (contracts/metrics.md) behind each panel.
import { writeFileSync } from "node:fs";
const ds = { type: "prometheus", uid: "prometheus" };
const WAIT = "waiting for filegrid-api metrics";
let id = 0;
const sel = 'category=~"$category", storage=~"$storage", op=~"$op"';
const q = (expr, legendFormat = "", extra = {}) => ({ refId: String.fromCharCode(65 + (extra.i ?? 0)), datasource: ds, expr, legendFormat, ...extra, i: undefined });
const targets = (...ts) => ts.map((t, i) => ({ ...t, refId: String.fromCharCode(65 + i) }));
const row = (title, y) => ({ id: ++id, type: "row", title, collapsed: false, gridPos: { x: 0, y, w: 24, h: 1 }, panels: [] });
const ts = (title, description, gridPos, tgts, unit, extra = {}) => ({
  id: ++id, type: "timeseries", title, description, gridPos, datasource: ds, targets: targets(...tgts),
  fieldConfig: { defaults: { unit, min: 0, ...(unit === "percentunit" ? { max: 1 } : {}), noValue: extra.noValue ?? WAIT, custom: { lineWidth: 2, fillOpacity: 8, showPoints: "never", spanNulls: true } }, overrides: extra.overrides ?? [] },
  options: { legend: { displayMode: "table", placement: "right", calcs: ["lastNotNull", "max"] }, tooltip: { mode: "multi", sort: "desc" } },
});
const stat = (title, description, gridPos, tgts, unit, steps, extra = {}) => ({
  id: ++id, type: "stat", title, description, gridPos, datasource: ds, targets: targets(...tgts),
  options: { colorMode: extra.colorMode ?? "value", graphMode: extra.graphMode ?? "area", textMode: extra.textMode ?? "auto", justifyMode: "auto", reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false } },
  fieldConfig: { defaults: { unit, decimals: extra.decimals, noValue: extra.noValue ?? WAIT, mappings: extra.mappings ?? [], thresholds: { mode: "absolute", steps } }, overrides: [] },
});
const green = [{ color: "green", value: null }];
const quant = (p, by = "le, category, storage, op") =>
  `histogram_quantile(${p}, sum by (${by}) (rate(filegrid_op_duration_seconds_bucket{${sel}}[$__rate_interval])))`;
const errRate = (by, win = "$__rate_interval") =>
  `(sum by (${by}) (rate(filegrid_ops_total{${sel}, outcome="error"}[${win}])) or sum by (${by}) (rate(filegrid_ops_total{${sel}}[${win}])) * 0)\n/ sum by (${by}) (rate(filegrid_ops_total{${sel}}[${win}]))`;
const leg = "{{category}} · {{storage}} · {{op}}";

const panels = [];
let y = 0;
// ---------------------------------------------------------------- health
panels.push(row("Is FileGrid up?", y)); y += 1;
panels.push({
  id: ++id, type: "stat", title: "Services running", description: "Prometheus scrape status of every service (`up`, 1 = scraped).",
  gridPos: { x: 0, y, w: 12, h: 4 }, datasource: ds, targets: targets(q("up", "{{job}}")),
  options: { colorMode: "background", graphMode: "none", textMode: "value_and_name", reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false } },
  fieldConfig: { defaults: { mappings: [{ type: "value", options: { "0": { text: "down", color: "red" }, "1": { text: "up", color: "green" } } }], thresholds: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "green", value: 1 }] } }, overrides: [] },
});
panels.push(stat("Handled per second", "filegrid_ops_total: all storage operations per second for the selected category, storage and op.", { x: 12, y, w: 4, h: 4 },
  [q(`sum(rate(filegrid_ops_total{${sel}}[$__rate_interval]))`)], "ops", green, { decimals: 1 }));
panels.push(stat("Operations failing", "filegrid_ops_total: share with outcome=error. Fallback writes are not errors.", { x: 16, y, w: 4, h: 4 },
  [q(errRate("").replaceAll("sum by () ", "sum "))], "percentunit", [{ color: "green", value: null }, { color: "orange", value: 0.001 }, { color: "red", value: 0.01 }], { decimals: 2 }));
panels.push(stat("Meter save time (p95)", "p95 of filegrid_op_duration_seconds for meter writes. Must stay flat during storms in other categories. MeterIngestLatencyHigh fires above 0.5 s.", { x: 20, y, w: 4, h: 4 },
  [q(`histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="meter", op="write"}[$__rate_interval])))`)], "s",
  [{ color: "green", value: null }, { color: "orange", value: 0.25 }, { color: "red", value: 0.5 }], { decimals: 3 }));
y += 4;
// ---------------------------------------------------------------- storm
panels.push(row("Storm: does a spike in one category slow the others?", y)); y += 1;
const p95of = (cat) => `histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="${cat}", op="write"}[$__rate_interval])))`;
panels.push(ts("Save time, meter vs outage (95 % within)",
  "p95 of filegrid_op_duration_seconds (writes). During an outage storm the outage line may rise; the meter line must stay flat and under 0.5 s (MeterIngestLatencyHigh).",
  { x: 0, y, w: 8, h: 8 }, [q(p95of("meter"), "meter readings", { exemplar: true }), q(p95of("outage"), "outage records", { exemplar: true }), q(p95of("document"), "documents", { exemplar: true })], "s",
  { overrides: [
    { matcher: { id: "byName", options: "meter readings" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "green" } }, { id: "custom.lineWidth", value: 3 }] },
    { matcher: { id: "byName", options: "outage records" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "orange" } }] },
  ] }));
panels.push(ts("Work waiting, per category",
  "filegrid_queue_depth: items waiting in each category's queue (bulkhead). Until filegrid-api emits it, 'requests in progress' shows all requests being worked on across instances (http_server_requests_active_seconds_gcount, minus the scrape itself).",
  { x: 8, y, w: 8, h: 8 },
  [q("sum by (category) (filegrid_queue_depth)", "{{category}} waiting"),
   q('label_replace(clamp_min(sum(http_server_requests_active_seconds_gcount{job="filegrid-api"}) - count(count by (instance) (http_server_requests_active_seconds_gcount{job="filegrid-api"})), 0), "category", "requests in progress (all)", "", "")', "{{category}}")],
  "short"));
panels.push(ts("Arrivals per second, per category",
  "filegrid_ops_total writes per category: the storm shows as one line jumping tenfold while the others stay put.",
  { x: 16, y, w: 8, h: 8 }, [q('sum by (category) (rate(filegrid_ops_total{op="write"}[$__rate_interval]))', "{{category}}")], "ops"));
y += 8;
// ---------------------------------------------------------------- latency
panels.push(row("How long saves and downloads take, per category and storage", y)); y += 1;
const m = (expr, i) => ({ ...q(expr), instant: true, range: false, format: "table" });
panels.push({
  id: ++id, type: "table", title: "Every category on every storage: speed and failures (last 5 min)",
  description: "One row per category × storage × op: p50/p95/p99 from filegrid_op_duration_seconds, throughput and error rate from filegrid_ops_total.",
  gridPos: { x: 0, y, w: 24, h: 8 }, datasource: ds,
  targets: targets(
    m(`histogram_quantile(0.5, sum by (le, category, storage, op) (rate(filegrid_op_duration_seconds_bucket{${sel}}[5m])))`),
    m(`histogram_quantile(0.95, sum by (le, category, storage, op) (rate(filegrid_op_duration_seconds_bucket{${sel}}[5m])))`),
    m(`histogram_quantile(0.99, sum by (le, category, storage, op) (rate(filegrid_op_duration_seconds_bucket{${sel}}[5m])))`),
    m(`sum by (category, storage, op) (rate(filegrid_ops_total{${sel}}[5m]))`),
    m(errRate("category, storage, op", "5m")),
  ),
  transformations: [
    { id: "merge", options: {} },
    { id: "organize", options: { excludeByName: { Time: true }, indexByName: { category: 0, storage: 1, op: 2, "Value #A": 3, "Value #B": 4, "Value #C": 5, "Value #D": 6, "Value #E": 7 },
      renameByName: { "Value #A": "typical (p50)", "Value #B": "slow end (p95)", "Value #C": "slowest 1 % (p99)", "Value #D": "per second", "Value #E": "failing" } } },
    { id: "sortBy", options: { sort: [{ field: "category" }] } },
  ],
  options: { showHeader: true, cellHeight: "sm", footer: { show: false } },
  fieldConfig: {
    defaults: { noValue: WAIT, custom: { align: "auto", cellOptions: { type: "auto" } }, thresholds: { mode: "absolute", steps: green } },
    overrides: [
      ...["typical (p50)", "slow end (p95)", "slowest 1 % (p99)"].map((n) => ({ matcher: { id: "byName", options: n }, properties: [{ id: "unit", value: "s" }, { id: "decimals", value: 3 }] })),
      { matcher: { id: "byName", options: "slow end (p95)" }, properties: [{ id: "custom.cellOptions", value: { type: "color-background", mode: "basic" } }, { id: "thresholds", value: { mode: "absolute", steps: [{ color: "green", value: null }, { color: "orange", value: 0.5 }, { color: "red", value: 2 }] } }] },
      { matcher: { id: "byName", options: "per second" }, properties: [{ id: "unit", value: "ops" }, { id: "decimals", value: 2 }] },
      { matcher: { id: "byName", options: "failing" }, properties: [{ id: "unit", value: "percentunit" }, { id: "decimals", value: 2 }, { id: "custom.cellOptions", value: { type: "color-text" } }, { id: "thresholds", value: { mode: "absolute", steps: [{ color: "green", value: null }, { color: "red", value: 0.01 }] } }] },
    ],
  },
});
y += 8;
for (const [i, p] of [[0, 0.5], [1, 0.95], [2, 0.99]]) {
  const label = { 0.5: "Typical time (half are faster, p50)", 0.95: "Slow end (95 % are faster, p95)", 0.99: "Slowest 1 % (p99)" }[p];
  panels.push(ts(label, `histogram_quantile(${p}) of filegrid_op_duration_seconds per category × storage × op.`,
    // exemplar: true draws one dot per sampled request; clicking it opens that request's
    // trace in Tempo (datasource exemplarTraceIdDestinations), and from there its logs.
    { x: i * 8, y, w: 8, h: 8 }, [q(quant(p), leg, { exemplar: true })], "s"));
}
y += 8;
// ---------------------------------------------------------------- throughput
panels.push(row("How much work, and how much of it fails", y)); y += 1;
panels.push(ts("Operations per second, per category and storage", "filegrid_ops_total, rate.", { x: 0, y, w: 8, h: 8 },
  [q(`sum by (category, storage, op) (rate(filegrid_ops_total{${sel}}[$__rate_interval]))`, leg)], "ops"));
panels.push(ts("Failing operations, per category and storage", "filegrid_ops_total: outcome=error / all operations, per category × storage × op.", { x: 8, y, w: 8, h: 8 },
  [q(errRate("category, storage, op"), leg)], "percentunit"));
panels.push(ts("Saved to the fallback storage instead", "filegrid_ops_total outcome=fallback: the primary storage refused and the policy's fallback took the write.", { x: 16, y, w: 8, h: 8 },
  [q(`sum by (category, storage) (rate(filegrid_ops_total{${sel}, outcome="fallback"}[$__rate_interval]))`, "{{category}} · {{storage}}")], "ops"));
y += 8;
panels.push(ts("Work per FileGrid instance (scale-out)", "filegrid_ops_total by scrape instance: with `make scale N=3` the load spreads evenly over the replicas (NFR scalability: scale by adding instances).", { x: 0, y, w: 24, h: 6 },
  [q(`sum by (instance) (rate(filegrid_ops_total[$__rate_interval]))`, "{{instance}}")], "ops"));
y += 6;
// ---------------------------------------------------------------- meters
panels.push(row("Smart meters: every reading stored exactly once", y)); y += 1;
const NOSIM = "waiting for meter-simulator";
panels.push(ts("Meter readings per second: sent, confirmed, stored, duplicates",
  "Exactly-once proof. 'sent' counts unique readings only (retries excluded). 'accepted (FileGrid)' must track 'sent'; retries show up as 'duplicate (FileGrid)', never as extra accepted.",
  { x: 0, y, w: 16, h: 9 },
  [
    q("sum(rate(meter_sim_sent_total[$__rate_interval]))", "sent (simulator, unique)"),
    q("sum(rate(meter_sim_acked_total[$__rate_interval]))", "confirmed (simulator)"),
    q('sum(rate(filegrid_meter_readings_total{result="accepted"}[$__rate_interval]))', "stored (FileGrid)"),
    q('sum(rate(filegrid_meter_readings_total{result="duplicate"}[$__rate_interval]))', "duplicates refused (FileGrid)"),
    q("sum(rate(meter_sim_retries_total[$__rate_interval]))", "retries (same key)"),
    q("sum(meter_sim_rate)", "configured rate"),
  ], "reqps", {
    noValue: NOSIM,
    overrides: [
      { matcher: { id: "byName", options: "configured rate" }, properties: [{ id: "custom.lineStyle", value: { fill: "dash", dash: [10, 10] } }, { id: "color", value: { mode: "fixed", fixedColor: "text" } }, { id: "custom.fillOpacity", value: 0 }] },
      { matcher: { id: "byName", options: "sent (simulator, unique)" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "blue" } }] },
      { matcher: { id: "byName", options: "confirmed (simulator)" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "green" } }] },
      { matcher: { id: "byName", options: "stored (FileGrid)" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "purple" } }] },
      { matcher: { id: "byName", options: "duplicates refused (FileGrid)" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "orange" } }] },
      { matcher: { id: "byName", options: "retries (same key)" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "red" } }] },
    ],
  }));
const s3 = (x, yy) => ({ x, y: yy, w: 4, h: 3 });
panels.push(stat("Meters sending (readings/s)", "meter_sim_rate: readings per second after the profile multiplier (peak = 10x). Changes within one scrape.", s3(16, y),
  [q("sum(meter_sim_rate)")], "reqps", green, { noValue: NOSIM, decimals: 1, graphMode: "none" }));
panels.push(stat("Readings waiting for confirmation", "meter_sim_sent_total − meter_sim_acked_total since the simulator started: in flight or waiting for retry. A growing number means readings are at risk (MeterReadingLossRisk).", s3(20, y),
  [q("sum(meter_sim_sent_total) - sum(meter_sim_acked_total)")], "short", [{ color: "green", value: null }, { color: "orange", value: 50 }, { color: "red", value: 500 }], { noValue: NOSIM, decimals: 0 }));
panels.push(stat("Readings sent", "meter_sim_sent_total: unique readings generated in the selected time range.", s3(16, y + 3),
  [q("sum(increase(meter_sim_sent_total[$__range]))")], "short", green, { noValue: NOSIM, decimals: 0, graphMode: "none" }));
panels.push(stat("Readings stored", "filegrid_meter_readings_total{result=accepted}. Must equal 'Readings sent' once the pipeline drains: never lost, never duplicated.", s3(20, y + 3),
  [q('sum(increase(filegrid_meter_readings_total{result="accepted"}[$__range]))')], "short", green, { decimals: 0, graphMode: "none" }));
panels.push(stat("Duplicates refused", "filegrid_meter_readings_total{result=duplicate}: retries that FileGrid recognised by Idempotency-Key and did not store again.", s3(16, y + 6),
  [q('sum(increase(filegrid_meter_readings_total{result="duplicate"}[$__range]))')], "short", green, { decimals: 0, graphMode: "none" }));
panels.push(stat("Resends (same key)", "meter_sim_retries_total: resends by the simulator, always with the same Idempotency-Key and body.", s3(20, y + 6),
  [q("sum(increase(meter_sim_retries_total[$__range]))")], "short", green, { noValue: NOSIM, decimals: 0, graphMode: "none" }));
y += 9;
panels.push(ts("Readings per region", "meter_sim_sent_total by region (Muntenia, Banat, Dobrogea).", { x: 0, y, w: 12, h: 7 },
  [q("sum by (region) (rate(meter_sim_sent_total[$__rate_interval]))", "{{region}}")], "reqps", { noValue: NOSIM }));
panels.push(ts("Confirmations: new vs duplicate", "meter_sim_acked_total by result: accepted (201) vs duplicate (200).", { x: 12, y, w: 12, h: 7 },
  [q("sum by (result) (rate(meter_sim_acked_total[$__rate_interval]))", "{{result}}")], "reqps", { noValue: NOSIM }));
y += 7;
// ---------------------------------------------------------------- storages
panels.push(row("Storages: which are reachable, and what waits for them", y)); y += 1;
panels.push(stat("Storage reachable", "filegrid_storage_up: last health probe of each storage by filegrid-api.", { x: 0, y, w: 8, h: 5 },
  [q("max by (storage) (filegrid_storage_up)", "{{storage}}")], "none", [{ color: "transparent", value: null }],
  { colorMode: "background", graphMode: "none", textMode: "value_and_name", mappings: [{ type: "value", options: { "0": { text: "DOWN", color: "red" }, "1": { text: "UP", color: "green" } } }] }));
panels.push(stat("Storage cut off (circuit breaker)", "filegrid_circuit_open: OPEN means filegrid-api stopped calling this storage and routes to the fallback.", { x: 8, y, w: 8, h: 5 },
  [q("max by (storage) (filegrid_circuit_open)", "{{storage}}")], "none", [{ color: "transparent", value: null }],
  { colorMode: "background", graphMode: "none", textMode: "value_and_name", mappings: [{ type: "value", options: { "0": { text: "closed", color: "green" }, "1": { text: "OPEN", color: "red" } } }] }));
panels.push(ts("Files waiting for their storage (spool)", "filegrid_spool_pending: items parked in the fallback spool, waiting for their storage to return.", { x: 16, y, w: 8, h: 5 },
  [q("sum by (category) (filegrid_spool_pending)", "{{category}}")], "short"));

// ---------------------------------------------------------------- load tests
y += 5;
panels.push(row("Load tests: synthetic users through the gateway (k6)", y)); y += 1;
const K6 = "run make b-load S=<scenario>";
const t = 'testid=~"$testid"';
panels.push(ts("Synthetic requests per second", "k6_http_reqs_total per scenario. Pick a run with the testid variable (e.g. storm-outage-143005).", { x: 0, y, w: 8, h: 7 },
  [q(`sum by (testid, scenario) (rate(k6_http_reqs_total{${t}}[$__rate_interval]))`, "{{testid}} · {{scenario}}")], "reqps", { noValue: K6 }));
panels.push(ts("Upload time seen by users (95 % within)", "k6_http_req_duration_p95: client-side p95 of uploads as k6 sees them through the gateway (TLS included).", { x: 8, y, w: 8, h: 7 },
  [q(`max by (testid, category) (k6_http_req_duration_p95{${t}, name="upload"})`, "{{testid}} · {{category}}")], "s", { noValue: K6 }));
panels.push(ts("Checks passing: stored and byte-identical", "k6_checks_rate: share of k6 checks passing: upload 201, receipt SHA-256 = local SHA-256, download byte-identical, video resumed and complete.", { x: 16, y, w: 8, h: 7 },
  [q(`min by (testid) (k6_checks_rate{${t}})`, "{{testid}}")], "percentunit", { noValue: K6 }));

const custom = (name, label, values, current) => ({
  name, label, type: "custom", query: values.join(","), multi: true, includeAll: true,
  current: current ? { text: [current], value: [current] } : { text: ["All"], value: ["$__all"] },
  options: [{ text: "All", value: "$__all", selected: !current }, ...values.map((v) => ({ text: v, value: v, selected: v === current }))],
});
const dashboard = {
  uid: "filegrid-overview",
  title: "FileGrid Overview",
  description: "p50/p95/p99, throughput and errors per category × storage; meter exactly-once; storage health. Metric names: contracts/metrics.md.",
  tags: ["filegrid"],
  timezone: "browser",
  editable: true,
  graphTooltip: 1,
  schemaVersion: 39,
  version: 1,
  refresh: "5s",
  time: { from: "now-15m", to: "now" },
  timepicker: { refresh_intervals: ["5s", "10s", "30s", "1m", "5m"] },
  templating: { list: [
    custom("category", "Category", ["meter", "outage", "document", "video"]),
    custom("storage", "Storage", ["db", "s3", "ftp", "spool"]),
    custom("op", "Op", ["write", "read", "verify"], "write"),
    { name: "testid", label: "k6 run", type: "query", datasource: ds, query: { query: "label_values(k6_http_reqs_total, testid)", refId: "testid" },
      refresh: 2, sort: 2, multi: true, includeAll: true, allValue: ".*", current: { text: ["All"], value: ["$__all"] } },
  ] },
  annotations: { list: [{ builtIn: 1, datasource: { type: "grafana", uid: "-- Grafana --" }, enable: true, hide: true, iconColor: "rgba(0, 211, 255, 1)", name: "Annotations & Alerts", type: "dashboard" }] },
  panels,
};
writeFileSync(process.argv[2] ?? new URL("../dashboards/overview.json", import.meta.url), JSON.stringify(dashboard, (k, v) => (k === "i" || v === undefined ? undefined : v), 2) + "\n");
console.log(`panels: ${panels.length}`);
