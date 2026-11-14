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
| `METER_TARGET_URL` | same | `http://filegrid-api:8080/api/v1/meter-readings` | Real ingest. `http://mock-api:4010/api/v1/meter-readings` = Prism mock |
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
  chaos-control will forward `POST /chaos/meters` here. A live change lasts until the
  simulator restarts; then the rate and profile from `.env` apply again.
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

### Exactly-once against the real API (14 Nov, branch `zone-b/ftp-and-real-meters`)

From `make reset && make up`, at 20 readings/s: `filegrid-api` stopped for 25 s (513 readings
queued in the simulator), started again, then the simulator restarted with SIGTERM.
After draining: 1,365 rows in `meter_readings`, 1,365 distinct keys, and for every one of
the 500 meters the row count equals its highest seq, which equals the simulator's last
generated seq. Nothing lost, nothing stored twice.

## FTP server (`infra/ftp`)

Replaces `stilliard/pure-ftpd:hardened`, which zone A reported as crashing on Apple Silicon
(amd64-only image under emulation). It also failed on amd64: pure-ftpd's TLS mode reset
every data connection from Java's `FTPSClient` (`Connection reset by peer`, 0-byte
`.part` files), so no document could be stored. curl reproduced the reset once TLS session
reuse was turned off (`--no-sessionid`), and Commons Net does not reuse the session.

Now: vsftpd on `debian:bookworm-slim` (multi-arch), built locally.
- FTPS mandatory for login and data (`force_local_logins_ssl`, `force_local_data_ssl`);
  a plain-text login gets `530`. Self-signed certificate generated at first start.
- `require_ssl_reuse=NO` for Java's FTPS client. The data connection must still come from
  the control connection's IP (`pasv_promiscuous=NO`), and the server is only on `data`.
- Passive ports 30000–30009 on the `data` network only. Nothing is published.
- `init: true`: as PID 1, vsftpd's listener exited after download sessions ended (orphaned
  session processes are re-parented to PID 1), restarting the container after each
  download. Under tini: 12 consecutive downloads, 0 restarts.
- A small PAM service (`pam-filegrid`): Debian's default vsftpd profile requires a login
  shell, which the service account should not have.

Evidence (amd64): documents of 1 KB, 300 KB, 9 MB and 19 MB uploaded through
`https://localhost/api/v1/files`: stored on `ftp`, download 200, bytes and
`X-Content-SHA256` match the original, `verify` → `ok: true`.
Not verified: an arm64 run. This machine has no arm64 emulation; the base image and
packages are published for arm64, so zone A should re-check on their Mac.

## chaos-control (`services/chaos-control`)

Implements every `/chaos/*` route of `contracts/openapi.yaml`, so the demo can break things
on cue: NFR resilience (storage down, corruption, lossy links) and scalability (storms).

### Access

- Every `/chaos/*` route, `GET /chaos/state` included, needs `Authorization: Bearer <JWT>`
  with `role: admin`: 401 without a valid token, 403 for other roles. The token is the HS256
  JWT that filegrid-api issues at `POST /api/v1/auth/login` (claims `sub`, `role`, `iat`,
  `exp`, signed with `JWT_SECRET`). Verification copies zone A's `JwtService`: `alg` must be
  exactly HS256, the signature is always recomputed, and `exp` is required.
- `make b-token` prints an admin JWT (8 h) signed inside the container, for curl and scripts.
- `/health` and `/metrics` (port 8090) stay open. Caddy only routes `/chaos/*`.

### Actions

| Route | What it does |
| --- | --- |
| `GET /state` | Storages from Docker, network from Toxiproxy (toxics named `fg_*`), meters from the simulator, storm, last 50 actions. Each part is read from its source, so it stays correct after restarts or manual `docker compose` use. |
| `POST /storages/{db\|s3\|ftp}/{stop\|start}` | Docker stop (10 s grace, so PostgreSQL shuts down cleanly) / start of `postgres`, `seaweedfs` or `ftp`. |
| `POST /network` | Toxiproxy toxics on `client` (the slow lane, :8443), `db`, `s3` or `ftp`. Latency and jitter are split over both directions, so the round trip grows by `latencyMs`. `bandwidthKbps` applies both ways. TCP proxies cannot drop single packets, so `lossPct` resets that share of connections 1 s in, which an HTTP client sees as a broken transfer it must resume. All zeros clear the target. |
| `POST /corrupt` | Looks the file up in `files`, then flips the middle byte **in the storage itself**: `stored_blobs` (SQL), the SeaweedFS filer (`/buckets/<bucket>/<key>`, streamed, so 1 GB works with flat memory) or the FTP file on disk. |
| `POST /storm` | `meter`: simulator rate × multiplier, restored at the end. `outage` / `document`: chaos-control uploads random files at baseline × multiplier (outage 0.5/s × 2 MB, document 0.5/s × 512 KB), open loop, at most 32 in flight, with the caller's token. `video`: 409 until tus exists (zone A P1). |
| `POST /meters` | Simulator base rate. Ends a running meter storm without restoring the old rate. |
| `POST /reset` | Ends the storm, removes every toxic, starts all three storages, meters back to `METER_READINGS_PER_SEC` with profile `normal`. |

Metrics: `chaos_actions_total{action,result}`, `chaos_storm_uploads_total{category,result}`
(not on a dashboard yet, so not listed in `contracts/metrics.md`).

### Docker socket

- Mounted only here, read-write, from `DOCKER_HOST_SOCKET` (default `/var/run/docker.sock`).
- The code can only address three Compose services (`postgres`, `seaweedfs`, `ftp`), and
  only in its own project: it reads `com.docker.compose.project` from its own container.
- Exec runs only fixed commands: one SQL lookup, one SQL update, one shell byte flip.
  The file id (UUID-validated) and the object key (shape-checked, no `..`) are passed as
  arguments, never spliced into SQL or shell.
- The entrypoint joins the socket's group (its gid differs per host), then `su-exec` drops
  to `node`. The container has `cap_drop: ALL` plus SETUID/SETGID, and `no-new-privileges`.
- Corruption runs through the socket rather than with storage credentials, because socket
  access already outranks any database password. No extra secret is needed.

### Evidence (14 Nov, branch `zone-b/chaos-control`)

- Auth: no token → 401, garbage token → 401, dispatch JWT → 403, admin → 200.
- Corrupt: outage on s3 (byte 150000), document on ftp (byte 200000), and a row inserted
  with `storage = db` (byte 50000; checked in `stored_blobs`): download before 200, after
  **422 INTEGRITY_FAILED**, `verify` → `ok: false`. Unknown id → 404, non-UUID → 400.
- `stop s3`: container exited at once; documents (ftp) still 201; 152 meter readings
  accepted in 15 s at 10/s; outage uploads 503 (no fallback yet, see requests).
  `reset` brought SeaweedFS back.
- Network on the slow lane: 400 ms latency → request 0.015 s → 0.81 s (port 443 still
  0.004 s); 800 kbit/s → a 500 KB upload took 5.2 s.
- Storm outage ×10 for 20 s: outage writes rose to 4.7/s (target 5/s), 99 uploads ok,
  outage p95 0.02 s, **meter p95 flat at 0.01 s**. Ended on time. Meter storm ×10: 1 → 10/s
  and back to 1/s at the end.

## Alert rules (`infra/prometheus/rules/filegrid.yml`)

One rule per alert in `contracts/alerts.md`. Each carries `severity`, `category` and
`guarantee`, plus a `summary` and `description` the narrator can read out.
`infra/prometheus/tests/filegrid.test.yml` runs them with `promtool test rules` against
synthetic series, covering both firing and look-alikes that must stay quiet
(`make b-rules`, also a CI job).

| Alert | Fires when | for | Signal today |
| --- | --- | --- | --- |
| `MeterReadingLossRisk` | sent − acked over 2 min > 50, or meter readings in the spool | 1m | ✅ simulator; spool pending (A) |
| `MeterIngestLatencyHigh` | meter write p95 > 0.5 s | 2m | ✅ |
| `OutageAvailabilityDegraded` | outage write p95 > 2 s, or > 1 % errors | 2m | ✅ |
| `DocumentProtectionFailure` | unencrypted document write, or audit-chain failure | — | ❌ needs 2 new metrics (proposal below) |
| `VideoTransferStalling` | > 5 tus resumes for video in 10 min | — | ✅ proxy (`filegrid_upload_resumes_total`); a stall gauge is proposed below |
| `StorageDown` | `filegrid_storage_up == 0`, or every write to a storage failing with none succeeding | 30s | ✅ via traffic; gauge pending (A) |
| `IntegrityFailure` | integrity failures increased in 5 min | — | ✅ |
| `ServiceDown` (extra) | a scrape target is down | 30s | ✅ |

Decisions:
- **StorageDown has a traffic-based branch.** zone A does not emit `filegrid_storage_up`
  yet. "Writes to this storage fail and none succeed" catches a dead storage today, and
  ignores failed reads (a corrupted file on a healthy storage). It keeps working once the
  gauge exists.
- **IntegrityFailure catches the first failure.** Micrometer creates the counter at the
  first failure with value 1, so `increase()` reads 0 and the base rule never fired for a
  storage's first corruption. The rule now also fires on a series that did not exist 5
  minutes ago.
- **MeterReadingLossRisk waits 1 minute.** A burst of slow acks below 50 readings does not
  page; a real outage at 10/s crosses it within seconds and fires after the `for`.

Evidence (14 Nov, live, chaos-control from #17):
- `stop db` at 10 readings/s: `MeterReadingLossRisk` pending after 10 s, firing at
  72 s, **received by insights at 82 s** (acceptance: < 2 min). `StorageDown{storage="db"}`
  and `MeterIngestLatencyHigh` followed. After `start db`, the simulator drained to 0
  pending and every alert resolved within 71 s. insights counted 3 firing and 3 resolved
  notifications.
- Corrupt a document on ftp + download (422): `IntegrityFailure{category="document",
  storage="ftp"}` firing after 10 s and delivered to insights.

## Requests to other zones

- **Zone A:** `meter_intervals` stays empty; `meter_readings` is filled. Zone C's anomaly
  baselines need the parsed intervals (contracts/db.md).
- **Zone A:** `filegrid_storage_up`, `filegrid_circuit_open`, `filegrid_spool_pending` and
  `filegrid_queue_depth` are not emitted yet. The *Storages* row and the `StorageDown` alert
  depend on them.
- **Zone A:** a failed storage write logs nothing and the 503 body carries only the
  outermost message ("IOException caught while copying"). Logging the cause chain (no file
  names for documents) would have shown the `Connection reset by peer` directly.
- **Zone A (resilience):** with S3 stopped, outage uploads return 503. The policy's
  fallback (`outage → db`) is not applied yet.
- **Zone A (bug):** a write to `db` storage (fallback, or `X-FileGrid-Force-Storage: db`)
  fails: `stored_blobs` is inserted before the `files` row, so its foreign key
  (`stored_blobs_file_id_fkey`) rejects it. This also blocks the outage fallback.
- **Zone A (network chaos):** filegrid-api connects to `postgres:5432`, `seaweedfs:8333`
  and `ftp:21` directly, so `/chaos/network` on `db`/`s3`/`ftp` has no effect yet. To
  route through Toxiproxy, set `PG_URL=jdbc:postgresql://toxiproxy:15432/filegrid` and
  `S3_ENDPOINT=http://toxiproxy:18333` in `services/filegrid-api/compose.yml`. FTP only
  partly: passive data connections bypass the proxy, so only the control channel slows.
  The `client` target (slow lane) works today.
- **Zone C:** the chaos panel can call `/chaos/*` with the admin session's token. Every
  action answers 202 with the full `ChaosState`, including `log` for the timeline.
- **Zone A:** documents are stored with `encrypted: false` although the policy says
  `encrypt: true`. Expected until the crypto item lands; `DocumentProtectionFailure` will
  fire on it once wired.

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

- **JWT claims.** The contract names the roles but not the token. chaos-control and
  filegrid-api already agree (see zone A's `JwtService`). Proposed addition to
  `components.securitySchemes.bearer` in `openapi.yaml`:

  ```diff
       bearer:
         type: http
         scheme: bearer
         bearerFormat: JWT
  +      description: |
  +        HS256, signed with JWT_SECRET. Claims: sub (username), role (Role enum),
  +        iat, exp (required). Every /chaos route requires role admin.
  ```

- **Metrics for `DocumentProtectionFailure` and `VideoTransferStalling`.** The alerts in
  `contracts/alerts.md` need signals that `contracts/metrics.md` does not define. Proposed
  rows for the zone A table:

  ```diff
  +| `filegrid_unencrypted_writes_total` | counter | `category`, `storage` | Writes stored without encryption although the policy says `encrypt: true`. Must stay 0. |
  +| `filegrid_audit_chain_failures_total` | counter | — | Audit-log hash-chain verification failures. Must stay 0. |
  +| `filegrid_upload_stalled` | gauge | `category` | Active tus uploads with no new bytes for 5 minutes. |
  ```

  The rule for the first two is already in place and tested, so it works as soon as they
  are emitted. With the gauge, `VideoTransferStalling` would become
  `max(filegrid_upload_stalled{category="video"}) > 0`.

- None needed for this work. Cosmetic only: `MeterReadingFile.county` uses the example
  `Prahova`, which is outside the Rețele Electrice area. `Ilfov` would match `RO-MT-000123`:

  ```diff
  -        county: { type: string, example: Prahova }
  +        county: { type: string, example: Ilfov }
  ```
