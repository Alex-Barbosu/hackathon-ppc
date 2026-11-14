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

## Load tests and scale-out (`loadtest/`, Caddy)

### k6

`make b-load S=<scenario>` runs `grafana/k6` in the gateway's network namespace (or
Toxiproxy's for the slow lane), so https://localhost is Caddy: TLS, routing and login
exactly as a browser sees them, with no host port or extra certificate. Compose profile
`load`, so `make up` never starts k6. Results are pushed to Prometheus (`k6_*`, label
`testid`) and shown in the Overview row *Load tests*. Scenario details:
`loadtest/README.md`.

Every upload is checked twice: the receipt's SHA-256 must equal the one k6 computed
locally, and the downloaded bytes must hash to it again.

### Scale-out: the gateway did not balance

`make scale N=3` started three replicas, but Caddy's upstream `filegrid-api:8080` is a
single target: it resolves one IP per connection and keep-alive pins it. Measured: 300
sequential requests → 49 / 254 / 1 over the three replicas. Now the API route uses
`dynamic a filegrid-api 8080` (refresh 5 s): one upstream per replica, round robin.
Measured: **101 / 100 / 100**.

Active health checks do not run for dynamic upstreams. Instead, a dial failure (a replica
booting or killed) is retried on the next replica for up to 10 s (`lb_try_duration`) and the
replica is skipped for 15 s (`fail_duration`). Only connection failures are retried, so a
request body is never sent twice.

Also fixed: Caddy's config was mounted as a single file, which pins the inode. After a
`git switch` or an editor save, Caddy kept the old Caddyfile even after `caddy reload`.
The whole `infra/caddy` directory is mounted now.

### Evidence (14 Nov, branch `zone-b/k6-load`)

- `baseline` 30 s: 121/121 checks, 0 failed requests, outage upload p95 0.37 s,
  document p95 0.18 s.
- `storm-outage` ×10 for 90 s at 10 meter readings/s: 180 storm uploads of 5 MB
  (970 MB sent), 0 failures; documents 46 uploads, 0 failures, p95 0.10 s; meter p95
  0.003 s mid-storm, 0.016 s after.
- `video-lossy` 256 MB over 150 ms ± 50 ms and 20 % loss, one connection per chunk:
  7 chunks cut, 5 resumes, finished in 89 s, download byte-identical;
  `filegrid_upload_resumes_total{category="video"}` 1 → 6.
- 1.1 GB video (no toxics): uploaded in 10.5 s, download byte-identical; peak API replica
  memory 690 MiB (max heap 3.4 GiB), so the file never sat in memory.
- 3 replicas, `docker kill` of one 15 s into a 45 s run at 2 uploads/s: 416/416 checks,
  **0 of 232 requests failed**.

## Demo round (14 Nov evening, branch `zone-b/demo-round`)

### `make up` updates stale defaults (`scripts/init-env.sh`)

`.env` is generated once, so a default that changes later (`METER_TARGET_URL` moved from the
mock to the real API) stayed stale on every existing machine. Now a key is updated when
`.env` holds a value that some committed `.env.example` once shipped (from
`git log -p .env.example`). A value you typed never appears in that history and is kept.
Secrets are never touched, and without git (a zip download) nothing is changed.

### `make up` waits until files can be stored (`scripts/wait-ready.sh`)

Containers were healthy while filegrid-api still had S3 marked down. It starts as soon as
PostgreSQL is up, and its first SeaweedFS probe can fail and open that circuit for ~15 s. In
that window the fresh-clone test stored an outage record in the fallback and got 503 for a
video. `make up` now also polls `/api/v1/storages/health` until all three storages are up
and every circuit is closed (12 s on a cold start, 0 s on a warm one).

### In-stack clients through the gateway (Caddy `:8088`)

The meter simulator and chaos storms called `filegrid-api:8080` directly. Node's keep-alive
pinned them to the replica DNS returned first, so after `make scale N=3` one replica took
all meter traffic. Caddy now also listens on `:8088`, plain HTTP on the `app` network only,
never published, `/api/*` only. It uses the same upstream block as the public site, so their
requests are balanced like a browser's: 300 health requests → 101 / 100 / 99.

Caddy upstream changes, each from a measured failure:
- **No passive health.** Caddy counted any proxy error as a replica failure, including an
  upload whose body the API closed early. Under a storm that marked every healthy replica
  down at once: 161 × "no upstreams available", 503 for every category.
- **`dial_timeout 1s`.** A killed replica's IP answers nothing until DNS drops it. The
  default 3 s per attempt held requests for up to the 10 s retry window.
- **`keepalive 10s`.** This is below Tomcat's 20 s idle timeout. Before, Caddy reused
  connections Tomcat was closing: 502 "invalid Read on closed Body".
- **`--watch`.** Caddy reloads when the Caddyfile changes. `make up` does not recreate the
  container for a config edit.

Remaining edge: when a replica is removed under load, requests in flight on it are cut. The
gateway does not resend them, because uploads are not idempotent. The client resends, as the
web app's uploader and k6 do. Measured with `make demo-scale` (3 replicas, outage storm ×10,
one replica stopped at +30 s): 3 of 157 requests cut, all resent, **305/305 checks passed**
(every upload stored and byte-identical), meter p95 2.9 ms. A storm with no replica removed:
0 of 155 failed.

### `make demo`, `make demo-scale`, `make fresh-test`

POSIX sh and curl only (`scripts/lib.sh`), so they run on a Mac as is.
- `make demo`: six steps with pauses. Each prints the numbers it proves. `DEMO_AUTO=<s>`
  runs it unattended, and Ctrl-C or an error resets the chaos (tested with S3 stopped).
  Unattended run: meter p95 3.0 ms at baseline and 2.8 ms during the storm, while outage
  saves went to 5/s. With S3 stopped, outage went to `db`, a document to `ftp` (encrypted),
  meters stayed at 10/s, and `StorageDown` fired. Slow lane 3 ms → 807 ms. Corrupted
  document → 422, `IntegrityFailure` fired. After reset, all storages were back.
- `make demo-scale`: see above, plus a 64–256 MB video over the lossy lane, byte-identical.
- `make fresh-test`: clones into a temp dir under its own Compose project (separate
  containers, networks, volumes, images). `--stop-running` pauses a stack holding port
  443 and brings it back with `up` from its own folder. Plain `start` left Caddy without
  its `app` network and every `/api` call failed. Last run: **43 passed, 0 failed**,
  `make up` 38 s.

### Grafana

- Storm row under the health stats: meter vs outage vs document save time (p95), work
  waiting per category, arrivals per category. `filegrid_queue_depth` is not emitted yet
  (zone A: bulkheads not built), so the panel also shows requests in progress across
  instances. The per-category lines appear by themselves once the metric exists.
- Titles answer a decision maker's question ("Is FileGrid up?", "Storm: does a spike in
  one category slow the others?"). Descriptions keep the metric names.
- The source is in the repo now: `infra/grafana/src/overview.mjs`, rebuilt with
  `make b-dashboards`.

## Continue in a new session

Paste the block below as the first message of a new agent session (Kiro Crew, CLI or IDE).
Keep it current: update STATE and REMAINING BACKLOG when a PR merges.

````text
You are the engineer for ZONE B (platform and reliability) of FileGrid, a 24-hour hackathon project (Rețele Electrice România / PPC: one entry point for meter, outage, document and video files; FTP + S3 + PostgreSQL; must prove integrity and measure everything). Workspace: /home/robert/Diverse/hackathon-ppc (GitHub: Alex-Barbosu/hackathon-ppc, I am RORO123b, `gh` is logged in).

READ FIRST, fully: CLAUDE.md (root), infra/CLAUDE.md (my scope and backlog), docs/b.md (everything built so far, evidence, open requests), README.md ("Quick start" and "Prove it").
Then run `git fetch && git switch main && git pull` and look at `gh pr list --state all --limit 15`. Zones A (CalinCodes: services/filegrid-api, config/) and C (Alex-Barbosu: apps/web, services/insights) merge to main in parallel, so check what changed before you start. They may have shipped metrics or endpoints I listed as missing.

HARD RULES
- Edit ONLY: infra/**, services/meter-simulator/**, services/chaos-control/**, loadtest/**, Makefile, make/b.mk, .env.example, README.md, docs/b.md, .github/**, scripts/**.
- Never edit contracts/, root compose.yml, or other zones' files. If I need a contract change, write the proposed diff in docs/b.md for me to raise. Never publish a storage port. The Docker socket is mounted only in chaos-control.
- `make up` on main must keep working. Run `make reset && make up` (or `make fresh-test`) before every PR.
- Branch `zone-b/<feature>`, ONE PR to main per feature, never stacked on another open PR (a stacked PR merged into its base branch earlier and its code never reached main). Conventional commits with the `b` scope. Each PR description lists which requirement each change proves.
- Don't claim something works without running it. Say what you did not verify. No secrets in the repo. Comments explain WHY. TypeScript strict, no `any`.

STATE (all merged to main)
- Meter simulator (500 meters, real counties, load curve, retries with the same Idempotency-Key, state saved across restarts, normal/peak profiles). It sends through the internal Caddy listener http://caddy:8088.
- FileGrid Overview Grafana dashboard with a Storm row and business-language titles. Its source is infra/grafana/src/overview.mjs. Regenerate with `make b-dashboards`.
- FTPS server is vsftpd (infra/ftp). Alert rules for all 7 contract alerts with promtool tests (`make b-rules`, CI job).
- chaos-control (all /chaos routes, admin JWT, Docker socket allowlist). Get a token with `make b-token`.
- k6 scenarios: `make b-load S=baseline|storm-outage|video-lossy`.
- Caddy load-balances over API replicas (`dynamic a`, no passive health, internal :8088 listener, --watch).
- `make demo`, `make demo-scale`, `make fresh-test` (last run: 43 passed, 0 failed), `scripts/wait-ready.sh` (make up waits until FileGrid reaches all three storages), and `make up` updates stale .env defaults.

REMAINING BACKLOG (infra/CLAUDE.md), in order
1. Traces: verify that clicking a slow point on a latency panel opens its trace in Tempo (exemplars -> Tempo -> logs in Loki). Nothing has proven this yet. Fix infra/otel and the Grafana datasources if it does not work. Zone A's OTLP export is their side.
2. Separate dashboards Meters, Storages and Storm (the Overview has these as rows). Use the existing generator and keep panel names matching contracts/metrics.md.
3. Healthchecks for loki, tempo, mock-api, otel-collector, alertmanager and toxiproxy (backlog item 1 says healthchecks on everything). `make up --wait` must stay green.
4. Toxiproxy on the storage paths: filegrid-api connects to postgres/seaweedfs/ftp directly, so /chaos/network on db/s3/ftp has no effect. Zone A merged a "slow-lane-proof" PR (#37): read it first, it may already cover part of this. Anything in zone A's compose file is their change: write the request in docs/b.md for me to raise with CalinCodes (PG_URL=jdbc:postgresql://toxiproxy:15432/filegrid, S3_ENDPOINT=http://toxiproxy:18333).
5. Optional: Discord/Slack webhook receiver in Alertmanager from .env. A recorded backup of the demo. `make up-k8s` (k3d) only if everything else is green.
6. Keep the README "Prove it" table current as A and C ship features. It is the demo script. Re-run `make fresh-test` and `make demo` against main before the deadline (Sun 15 Nov ~12:00 Bucharest).

OPEN REQUESTS FOR OTHER ZONES (docs/b.md has the details): contract metrics for DocumentProtectionFailure and VideoTransferStalling (filegrid_unencrypted_writes_total, filegrid_audit_chain_failures_total, filegrid_upload_stalled); the JWT claims line for the OpenAPI security scheme; filegrid_queue_depth (zone A's bulkheads, not built; the Storm row shows requests in progress until it exists); meter_intervals never filled (zone C needs it).

GOTCHAS I HIT
- Docker Hub rate-limits anonymous pulls (100 per 6 h). If `make up` fails with "429 Too Many Requests": `docker login`, or `docker pull mirror.gcr.io/library/<image> && docker tag mirror.gcr.io/library/<image> <image>` for each base image (maven:3.9-eclipse-temurin-21, eclipse-temurin:21-jre-alpine, nginx:1.27-alpine, debian:bookworm-slim, node:22-alpine).
- Passwords are in .env (DEMO_PASSWORD for admin/dispatch/connections/field, GRAFANA_ADMIN_PASSWORD). Never print them in logs or commit them.
- `make fresh-test ARGS="--stop-running"` pauses an already-running stack on port 443 and restarts it afterwards.
- A background `make b-load` job without a terminal gets suspended. Run it in the foreground or use `/chaos/storm`.
- Don't leave COMPOSE_PROJECT_NAME exported in the shell: it makes `make up` start a second stack.

HOW TO WORK
Start by telling me in a few lines what changed on main since your last known state and your plan for item 1. Then proceed. For anything with a real choice (changing zone A's files, contract changes, dropping a backlog item), stop and ask. Keep replies short and in plain language. Report results with numbers, and say plainly what failed.
````

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
