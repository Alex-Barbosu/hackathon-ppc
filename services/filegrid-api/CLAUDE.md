# Zone A — Ingest core (filegrid-api)

> Read the root `CLAUDE.md` first. This file is your scope, backlog and rules.
> Owner: @CalinCodes.

## Mission
Make FileGrid correct: every file in every category is stored where the policy says,
comes back byte-identical, never duplicates a meter reading, never exposes personal data,
and keeps working when a storage dies. You own the code paths judges will try to break.

## You may edit
`services/filegrid-api/**`, `config/**`, `make/a.mk`, `docs/a.md`.
Migrations in `services/filegrid-api/src/main/resources/db/migration/` numbered **V100–V199** only.

## You must not edit
`apps/`, `services/insights/`, `services/meter-simulator/`, `services/chaos-control/`,
`infra/`, `loadtest/`, `Makefile`, root `compose.yml`, `README.md`, `contracts/` (only via contract PR).

## Stack
Java 21, Spring Boot 3.x with virtual threads (`spring.threads.virtual.enabled=true`),
Spring Web (not WebFlux), Spring Security (JWT resource server, self-issued HS256/RS256),
Flyway, AWS SDK v2 S3 client (path-style, endpoint = SeaweedFS), Apache Commons Net
`FTPSClient`, `tus-java-server`, Micrometer (Prometheus at `/actuator/prometheus`) + Micrometer Tracing with the OTel bridge exporting OTLP to the collector (already wired in the base), Resilience4j
(circuit breaker, bulkhead, retry), JUnit 5 + Testcontainers.

## Backlog (in priority order — top items gate the demo)
### P0 — gating (done by 17:00)
1. `StorageAdapter` interface: `write(InputStream, key, meta) → StoredRef`, `read(ref) → InputStream`, `delete`, `health`. Implementations: `DbStorage` (bytea in `stored_blobs`; large objects not needed for ≤ 50 MB), `S3Storage`, `FtpStorage` (FTPS, passive mode, write `key.part` → rename).
2. `POST /files`, `GET /files`, `GET /files/{id}`, `GET /files/{id}/content` per `openapi.yaml`.
3. SHA-256 computed **while streaming in** (DigestInputStream), stored in `files`; on read, recompute while streaming out and fail with `422 INTEGRITY_FAILED` if it differs (send trailer/last-chunk abort; also expose `POST /files/{id}/verify`).
4. Policy engine reads `config/policy.yaml`, validates against `policy.schema.json`, routes by category.
5. `POST /meter-readings` with `Idempotency-Key`: insert into `meter_readings` with unique `(meter_id, period_start, seq)`; `ON CONFLICT DO NOTHING`; return `200 duplicate` vs `201 accepted`. Ack only after commit.
6. Auth: `/auth/login` with demo users from env; roles per shared context; device token for meters.

### P1 — NFRs (done by 21:00)
7. **tus** endpoint `/api/v1/files/tus` streaming chunks straight to S3 multipart (16 MB parts); no full-file buffering; heap stays flat on 1 GB+ (prove with a metric/screenshot).
8. **Policy hot reload**: file watcher + `PUT /policy` (admin) storing `policy_versions`; no restart.
9. **Document encryption**: AES-256-GCM envelope encryption (per-file data key wrapped by a master key from env `FILEGRID_MASTER_KEY`); storage holds ciphertext only; metadata stores wrapped key + IV.
10. **Hash-chained audit log** for every document read/write: `hash = sha256(prev_hash || event_json)`.
11. **OTel**: spans `http → policy.route → storage.write` with attributes `category, storage, file.size`; Micrometer metrics exactly as named in `contracts/metrics.md`.

### P2 — resilience (done by 01:00)
12. **Bulkheads**: one bounded queue + worker pool per category (sizes from policy); a storm in `outage` must not touch `meter` latency.
13. **Circuit breaker per storage**; when open, write to policy `fallback`; `spool` = local volume + `spool_items` row, replayed by a scheduler when the storage recovers. Never ack before durable.
14. `X-FileGrid-Force-Storage` header (admin) for Storage Lab.
15. `/storages/health` with up/latency/circuit state.

### P3 — polish
16. Content-hash dedup for identical uploads (same category).
17. Signed receipts (`signature` = HMAC of receipt fields) shown in UI.
18. COMTRADE (`.cfg`/`.dat`) metadata extraction for outage files (station, fault time) to power hotspot stats.

## Acceptance checks you must be able to show
- Upload 1 GB video through Toxiproxy with 300 ms latency and 10 % loss; kill the connection mid-way; it resumes and the SHA-256 matches.
- Simulator retries every reading 3 times: `filegrid_meter_readings_total{result="accepted"}` equals readings sent; duplicates counted, never stored.
- Stop SeaweedFS: meter and document writes keep succeeding; outage writes go to fallback; restart: spool drains to 0.
- Flip one byte in a stored file: download returns `422` and `filegrid_integrity_failures_total` increments.
- `psql` / FTP directly on the volume: document content is ciphertext.

## Interfaces you provide / consume
- **Provide:** REST per `openapi.yaml`; metrics per `metrics.md`; tables per `db.md` (zone C builds read-only views on them — do not rename columns without a contract PR).
- **Consume:** storage hosts/credentials from env set by zone B's compose (`PG_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FILEGRID_MASTER_KEY`, `JWT_SECRET`).

## Useful tools for your agent
- **Skills (to author per project, small):** `contract-change` (how to propose an OpenAPI/metrics change PR); `spring-streaming` (rules: never `getBytes()` a request, use `InputStream`, check heap).
- **MCP:** Context7 (current Spring Boot / AWS SDK / tus docs); a read-only Postgres MCP pointed at the local DB for checking migrations; GitHub MCP for PRs.
- **Commands:** `make a-test` (unit + Testcontainers), `make a-run` (API alone against storages), `make up`.

## Gotchas
- SeaweedFS S3 needs path-style addressing and a pre-created bucket (zone B creates `filegrid-outage`, `filegrid-video`, `filegrid-document`).
- FTP has no atomic write: always `.part` then rename; verify size before rename.
- Do not log file names of documents (can contain personal names); log `file_id` only.
- Virtual threads + blocking JDBC/FTP is fine; do not pin with `synchronized` around I/O.
