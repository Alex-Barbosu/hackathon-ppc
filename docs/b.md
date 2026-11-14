# Zone B — Platform and reliability

Zone notes, decisions and demo evidence go here. The agent rules are in this zone's `CLAUDE.md`.

## Meter simulator (`services/meter-simulator`)

Proves gating requirement 7 (continuous readings, configurable volume) and the sender half of
"retries never duplicate meter readings".

### What it sends

- `METER_COUNT` meters (default 500) in the real service areas of the three distribution
  companies: Muntenia (București, Ilfov, Giurgiu), Banat (Timiș, Arad, Hunedoara,
  Caraș-Severin), Dobrogea (Constanța, Tulcea, Călărași, Ialomița). Counties are weighted by
  approximate customer share (Muntenia ≈ 45 %, Banat ≈ 32 %, Dobrogea ≈ 23 %), and meters are
  scattered around each county centre.
- Ids `RO-MT-000123`, `RO-BN-…`, `RO-DB-…`, numbered per region. Meter *i* depends only on
  *i*, so raising `METER_COUNT` adds meters without renumbering the existing ones.
- 88 % households (≈ 6.5 kWh/day), 12 % businesses (≈ 60 kWh/day). Households follow a
  November curve in Bucharest local time (EET/EEST): night trough ≈ 0.4x the daily mean,
  morning peak 07–09, evening peak 18–21 ≈ 1.9x. Weekends shift the morning peak later.
  Businesses have a working-hours plateau. Noise is per interval (±25 % households,
  ±10 % businesses) plus a per-day factor.
- Voltage around 230 V: per-meter offset (σ 2 V), a small drop under load, noise, clamped to
  EN 50160's ±10 %. Rare flags: `power_loss` (0.05 % of intervals, less energy, no voltage)
  and `clock_drift` (0.03 %).
- Each file is a `MeterReadingFile` with `METER_INTERVALS_PER_FILE` quarter hours
  (default 1). Files are padded to a seeded size between `METER_FILE_MIN_KB` and
  `METER_FILE_MAX_KB` (defaults 2–12, hard limits 1–50) with trailing whitespace, which
  RFC 8259 allows after the JSON value. This keeps the body schema-valid without a new
  contract field.

### Simulated time

500 meters at 15-minute cadence would produce 0.56 readings/s in real time. To make volume
configurable, each meter's next file covers the period right after its previous one, and the
scheduler goes round-robin over the meters. The simulated clock therefore runs
`900 × rate / METER_COUNT` times faster than real time (1.8x at the defaults, 36x at 20/s).
It starts `METER_BACKFILL_DAYS` (default 14) before the first start, so zone C has several
days of history for per-slot baselines. If the clock overtakes real time, the simulator logs
one warning and continues with future periods. `GET /health` shows `simulatedTime`.

### Delivery guarantees

- A reading stays pending until the target answers 201 (accepted) or 200 (duplicate).
  Network errors, timeouts (10 s), 5xx, 429, 401 and similar are retried without limit,
  using exponential backoff with full jitter (250 ms base, 30 s cap). Only 400, 413 and 422
  are treated as final; they are logged and stay un-acked, so the sent − acked gap shows them.
- Retries reuse the same `Idempotency-Key` (`{meterId}:{periodStart}:{seq}`) and a
  byte-identical body. Bodies are rebuilt from the reading's identity with a seeded PRNG
  instead of being held in memory, so a long outage costs a few bytes per pending reading.
  `test/sender.test.ts` checks key, body hash and trace id across retries.
- One W3C `traceparent` trace id per reading, with a new span id per attempt, so all
  retries of a reading share one trace.
- State (each meter's next period and seq, plus every un-acked reading) is saved every 2 s
  and on SIGTERM to the `meter-sim-data` volume. After a restart, un-acked readings are
  resent under their old keys (counted as retries, not as sent) and new readings continue
  after the last period. Without this, a rebuild would either replay old keys as false
  duplicates or report the same quarter hours again under new keys.
  Limitation: after a hard crash (no SIGTERM), readings generated in the last ≤ 2 s are
  regenerated and counted in `meter_sim_sent_total` a second time. The server still sees
  the same keys and answers duplicate.
- `make reset` deletes the volume together with the database, so both start over together.

### Configuration

| Env (in `.env`) | Container env | Default | Meaning |
| --- | --- | --- | --- |
| `METER_TARGET_URL` | same | `http://mock-api:4010/api/v1/meter-readings` | Switch to `http://filegrid-api:8080/api/v1/meter-readings` when zone A ships ingest |
| `METER_READINGS_PER_SEC` | `READINGS_PER_SEC` | 1 | Base global rate (0–5000) |
| `METER_PROFILE` | same | `normal` | `peak` = 10x the base rate |
| `METER_COUNT` | same | 500 | Number of meters |
| `METER_DEVICE_TOKEN` | same | generated | Sent as `Authorization: Bearer …` |

Advanced (container env only, defaults in `src/config.ts`): `METER_INTERVALS_PER_FILE`,
`METER_FILE_MIN_KB`, `METER_FILE_MAX_KB`, `METER_BACKFILL_DAYS`, `METER_MAX_IN_FLIGHT` (64),
`METER_REQUEST_TIMEOUT_MS`, `METER_RETRY_BASE_MS`, `METER_RETRY_MAX_MS`, `METER_STATE_PATH`.

### Control API (port 9100, `app` network only, not routed by Caddy)

- `GET /health`: rate, profile, simulated time, pending count, target.
- `GET /metrics`: exactly the `meter_sim_*` metrics of `contracts/metrics.md` (+ Node defaults).
- `GET /rate`, `POST /rate {readingsPerSec?, profile?}` → `{profile, baseReadingsPerSec, readingsPerSec}`.
  `readingsPerSec` sets the base rate; the profile multiplies it (capped at 5000).
  chaos-control will forward `POST /chaos/meters` here.
- Shortcuts: `make b-rate R=20`, `make b-profile P=peak`.

### Notes for zone A (ingest)

- Bodies end with whitespace padding. If `meter_readings.raw` is `jsonb`, Postgres drops it,
  so a SHA-256 of `raw` will not match the received bytes. Hash the request bytes if you
  record one.
- Per meter, intervals never overlap across distinct readings, so `meter_intervals`
  PK `(meter_id, ts)` holds without upserts. A retry carries the same key and the same
  intervals.
- The simulator reads the HTTP status only: 201 = accepted, 200 = duplicate (per the
  contract). Any other 2xx counts as accepted. 400/413/422 are final; everything else is retried.

### Notes for zone C (insights)

- `period_start` and interval `ts` are simulated time (see above), not `received_at`.
  Compare normal and peak days by `received_at`, or by the simulator profile switch times
  (in the simulator logs, "rate changed").
- No anomalies are injected yet besides the rare flags. Planted anomalies (theft-like drops,
  stuck meters, voltage sags) can be added if the anomaly feature needs ground truth.

## Grafana: FileGrid Overview (`infra/grafana/dashboards/overview.json`)

Home dashboard of https://localhost/grafana (`GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH`).
Variables `category`, `storage` (incl. `spool`) and `op` (default `write`) are fixed lists
from the contract enums, so they work before zone A emits anything.

| Row | Panels | Metrics |
| --- | --- | --- |
| Health | Services up, ops/s, error rate, meter write p95 (red at the 0.5 s alert threshold) | `up`, `filegrid_ops_total`, `filegrid_op_duration_seconds` |
| Latency per category × storage | Matrix table (p50/p95/p99, ops/s, error rate, last 5 min), p50/p95/p99 time series | `filegrid_op_duration_seconds_bucket`, `filegrid_ops_total` |
| Throughput and errors | Throughput, error rate, fallback writes | `filegrid_ops_total` |
| Meters | Sent vs acked vs accepted vs duplicate vs retries vs configured rate; stats for configured rate, unacked now, sent/accepted/duplicates/retries over the range; per region; acks by result | `meter_sim_*`, `filegrid_meter_readings_total` |
| Storages | Up, circuit breaker, spool pending | `filegrid_storage_up`, `filegrid_circuit_open`, `filegrid_spool_pending` |

The Prometheus datasource declares `timeInterval: 5s` (the scrape interval), so
`$__rate_interval` is 20 s instead of 60 s and rate changes show within seconds.
Every query was run against Prometheus. The panels fed by zone A's metrics are checked for
syntax only until filegrid-api emits them.

### Evidence (14 Nov, branch `zone-b/simulator-and-dashboards`)

- `make reset && make up`: all 17 services up, every service with a healthcheck healthy, 31 s (images cached).
- `POST /rate {"readingsPerSec":20}`: `meter_sim_rate` = 20 in Prometheus after 3.4 s;
  `rate(meter_sim_sent_total[20s])` passed 10/s after 8 s and reached 20.0 after 18 s.
- `profile: peak` at base 20: 200 readings/s, sent = acked.
- `docker compose stop mock-api` for 20 s at 20/s: 408 readings pending, 0 lost; after
  `start`, all were acked (sent = acked = 3445, 119 retries).

## Contract change proposals (for the humans to raise)

- None needed for this work. Cosmetic only: `MeterReadingFile.county` uses the example
  `Prahova`, which is outside the Rețele Electrice area. `Ilfov` would match `RO-MT-000123`:

  ```diff
  -        county: { type: string, example: Prahova }
  +        county: { type: string, example: Ilfov }
  ```
