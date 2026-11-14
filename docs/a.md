# Zone A — Ingest core

Zone notes, decisions and demo evidence go here. The agent rules are in this zone's `CLAUDE.md`.

## P0 storage core (branch `zone-a/storage-core`)

Items 1–6 of the backlog: every category storable and retrievable, integrity-proven,
routed by `config/policy.yaml`.

### What was built

- `StorageAdapter` interface (`storage/StorageAdapter.java`) with `write/read/delete/health`,
  all **streaming** — no implementation buffers a whole file.
  - `DbStorage` — bytea in `stored_blobs`, written with `setBinaryStream`, read with a
    streaming `ResultSet` binary stream (JDBC resources close when the caller closes the stream).
  - `S3Storage` — AWS SDK v2, path-style, endpoint `S3_ENDPOINT`, one bucket per category
    (`filegrid-<category>`), `RequestBody.fromInputStream` with the known size.
  - `FtpStorage` — Apache Commons Net `FTPSClient`, explicit TLS (`PBSZ 0` + `PROT P`),
    passive mode; writes `<key>.part`, verifies the server-reported size, then renames to
    `<key>` so a reader never sees a half file.
  - `StorageRegistry` resolves the adapter for a `Storage` value.
- `PolicyService` loads `FILEGRID_POLICY_FILE`, validates it against a **bundled copy** of
  `contracts/policy.schema.json` (`src/main/resources/policy.schema.json`), and answers
  `primaryStorageFor(category)` / `fallbackStorageFor(category)`. Routing is pure data, so
  changing storage per category is a file edit (gating requirement 3).
- Endpoints exactly per `openapi.yaml`: `POST /api/v1/files`, `GET /api/v1/files`,
  `GET /api/v1/files/{id}`, `GET /api/v1/files/{id}/content`, `POST /api/v1/files/{id}/verify`,
  `POST /api/v1/meter-readings`, plus `GET /api/v1/policy` and `GET /api/v1/storages/health`.
- SHA-256 computed with `DigestInputStream` while streaming in, stored in `files.sha256`.
  On download the stored object is re-hashed; a mismatch returns **422 INTEGRITY_FAILED**
  (Error schema) and increments `filegrid_integrity_failures_total{category,storage}`.
- Meter ingest: `ON CONFLICT (meter_id, period_start, seq) DO NOTHING`; the insert runs in
  its own transaction and the HTTP ack is built only after it returns, so a crash before
  commit acks nothing. First write → `201 {result: accepted}`, retry → `200 {result: duplicate}`;
  `filegrid_meter_readings_total{result}` counted after commit.
- Metrics registered so Prometheus sees the `metrics.md` names: `filegrid.op.duration`
  (Timer, `publishPercentileHistogram`) → `filegrid_op_duration_seconds`, `filegrid.ops`
  (Counter) → `filegrid_ops_total`, with tags `category, storage, op, outcome`; plus
  `filegrid_bytes_total`, `filegrid_meter_readings_total`, `filegrid_integrity_failures_total`.
- Auth is left open (next round) but seamed: `auth/AuthFilter` is a pass-through
  `OncePerRequestFilter`; turning auth on is editing its `authenticate` method only.

### Design decisions

- **Download verifies before streaming.** For files within the policy size cap (≤ 20 MB for
  the manual categories), download re-hashes the stored object first, then opens a fresh read
  stream, so a corrupt file fails with a clean 422 *before any body is sent*. The streamed
  single-pass path (trailer abort) is for the tus/video work in P1.
- **Policy schema is bundled.** The jar carries its own copy of `policy.schema.json` so
  validation does not depend on the `contracts/` dir being mounted. **This copy must track the
  contract**; the contract itself was not changed.
- **No `PGobject` at compile time.** `meter_readings.raw` is bound as a string and cast with
  `?::jsonb`, because the Postgres driver is `runtime` scope.

### Contract changes

None. All work fits `contracts/` v0. No proposed diff to raise.

### Verification

- `make a-test` (unit + the required PolicyService and SHA-256-mismatch tests): **11 tests pass,
  BUILD SUCCESS.** Built in a `maven:3.9-eclipse-temurin-21` container (no host JDK on this
  machine); the Dockerfile uses the same image.
- `mvn -DskipTests package`: assembles `filegrid-api-0.1.0.jar`.

### Live verification status

Run on `make up` (macOS arm64) through `https://localhost`, 2026-11-14:

| Check | Result |
| --- | --- |
| Outage upload (S3), 2 MiB | 201; receipt sha256 = local `shasum` |
| Outage download | 200; `X-Content-SHA256` and downloaded bytes hash equal the receipt |
| `POST /files/{id}/verify` | `ok: true` |
| Meter reading, same `Idempotency-Key` twice | `201 accepted`, then `200 duplicate` |
| `filegrid_meter_readings_total` | `accepted=1`, `duplicate=1` |
| `filegrid_ops_total` / `filegrid_op_duration_seconds` | present for `outage` write/read/verify (s3) and `meter` write (db) |
| Document upload (FTP) | **Not proven.** `/storages/health` reports `ftp` down. |

**FTP blocker (zone B, not edited here).** `stilliard/pure-ftpd:hardened` is an `amd64` image;
on Apple Silicon it runs under Rosetta and pure-ftpd fails with `mmap_anonymous_rw mmap failed`.
Request for zone B: pin `platform: linux/amd64` with a working emulation, or use an image
with an arm64 build. `FtpStorage` is unit-untested against a real server until this is fixed;
re-run the document upload/download check on a host where the FTP container is healthy.
The Grafana Explore view of `filegrid_ops_total` was not opened; the series exists on the
API's `/actuator/prometheus`.

### Gating requirement → change that proves it

| Requirement | Proven by |
| --- | --- |
| 1. Store & retrieve all four categories | `StorageAdapter` + `POST/GET /files`, `/content`; meter via `/meter-readings` |
| 2. FTP, S3 and a DB each really used | `DbStorage`, `S3Storage`, `FtpStorage`, routed by policy |
| 3. Policy configurable without code | `PolicyService` reads+validates `config/policy.yaml`; routing is data |
| 4. Byte-identical + provable | `DigestInputStream` in/out; `sha256` in receipt + `X-Content-SHA256`; 422 on mismatch + metric; `POST /verify` |
| Observability (metric names) | `FileGridMetrics` registers `filegrid.op.duration`/`filegrid.ops` → `filegrid_*` |
| Exactly-once meter readings | unique `(meter_id, period_start, seq)` + `ON CONFLICT DO NOTHING`, ack after commit, `filegrid_meter_readings_total{result}` |
