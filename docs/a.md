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
- Auth: see "Auth (branch `zone-a/auth`)" below.

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

## Auth (branch `zone-a/auth`)

Requested by zone C: login, download links, 404 for unknown routes, bearer enforced on `/files`.

### What a caller can use

| Credential | How it is sent | Reaches |
| --- | --- | --- |
| Session (JWT, HS256, 8 h) | `Authorization: Bearer <jwt>` from `POST /auth/login` | everything except `/meter-readings` (admin may use it too) |
| Meter device token | `Authorization: Bearer <METER_DEVICE_TOKEN>` | only `POST /meter-readings` |
| Download link token (60 s) | `?token=` on `GET /files/{id}/content` | that one file's content, once minted for it |
| none | | `/health`, `/auth/login`, `/actuator/*` (internal) |

- Demo users are `field`, `dispatch`, `connections`, `admin`; the username is the role and the
  password is `DEMO_PASSWORD`. A wrong password or unknown user gives the same `401`.
- `X-FileGrid-Force-Storage` is admin only (`403` otherwise), as the contract says.
- A download token is an HMAC (key `JWT_SECRET`) over file id, username and expiry. It cannot be
  used for another file, cannot mint another link, and cannot call `/verify`.
- The filter decides on the servlet path, not the raw URI, so `/meter-readings/../files` with a
  device token is still treated as `/files` and refused.
- `JWT_SECRET` must be at least 32 characters or the API refuses to start. An empty
  `DEMO_PASSWORD` or `METER_DEVICE_TOKEN` disables that credential; it never matches an empty value.
- Errors: unknown route `404 NOT_FOUND`, wrong method `405`, bad JSON or bad id `400`, all in the
  Error schema. Before this, they were `500`. `spring.web.resources.add-mappings=false` makes a POST
  to an unknown route a 404 instead of a 405.
- No token, password or download URL appears in logs (checked on the running stack).

### Not done yet, on purpose

- No per-category rules (for example documents only for `connections`). Every logged-in human can
  read and write every category. Needs a decision from the team before it is enforced.
- Document downloads are not written to the audit log yet (backlog item 10). The contract says every
  download-link use is audited for documents.
- Download still hashes the whole stored object before sending the first byte. For a 1 GB video that
  is a long wait for headers. The single-pass path (contract: abort the connection on a late
  mismatch) belongs with the tus work.
- Login has no rate limit.

### Verification

`make a-test`: 50 tests pass (22 in `AuthWebTest`, which runs the real filter, controllers and error
handler with storage mocked). Live on `make up`: no token `401`; bad password `401`; session `200`;
device token on `/files` `403`; device token on `/meter-readings` `201`; session on
`/meter-readings` `403`; unknown route `404`; download link streams the file with the same SHA-256
and a link for another file is `401`.

## Resumable video upload, tus (branch `zone-a/tus-video-upload`)

Backlog item 7. `POST /api/v1/files/tus`, `HEAD` and `PATCH /api/v1/files/tus/{id}`, tus 1.0.0 core plus
the creation extension, at the paths in `contracts/openapi.yaml`. Same bearer token as the rest of the API.

### How it works

- Each chunk is read from the socket into a buffer of one part (policy `chunkMb`, 16 MB for video) and sent to
  S3 as one multipart part. Memory per upload is one part, whatever the file size.
- The client may count on `Upload-Offset` bytes. Every byte below it is durable: in a finished S3 part, or in a
  small leftover object (`.tus/<id>.tail` in the same bucket) for bytes that have not filled a part yet. No
  file bytes are ever written to Postgres.
- State is in Postgres (`tus_uploads`, `tus_parts`, migration `V101`), so any API replica can take the next chunk.
  The offset moves by compare-and-set, so two requests racing on one upload cannot both win (`409`).
- A dropped connection keeps what had arrived: the offset after a drop is exactly the bytes received.
- SHA-256 is computed while the bytes stream in. If the chunks of one upload were not all handled by the same
  instance, the running digest does not exist there, so the finished object is read back once to hash it.
- On the last chunk the object is completed in S3, its size is checked against `Upload-Length`, and the `files`
  row and the completion mark are written in one transaction. The last response carries `X-FileGrid-File-Id`.
- Uploads idle for 24 h are aborted in S3 and deleted (hourly job), so abandoned uploads leave no orphan parts.
- `filegrid_upload_resumes_total{category}` counts a `HEAD` on an upload that already has bytes (a resume).
  Heap is visible as `jvm_memory_used_bytes{area="heap"}` on `/actuator/prometheus`.

### Rules and limits

- Only categories whose policy primary is `s3` can use tus (video, outage). Others get `400` and use `POST /files`.
  The contract says any category is allowed; this follows the policy so a document is never routed around its
  FTP rule. If the team wants tus for every category, that needs the db/ftp adapters to accept streams of unknown
  length.
- `Upload-Length` is required (no defer-length). Over the policy `maxSizeMb` gives `413`.
- No termination (`DELETE`) extension: it is not in the contract. Abandoned uploads expire instead.
- A category whose policy has `encrypt: true` or `audit: true` is refused on tus (`400`, use `POST /files`): this
  path does not encrypt or audit yet, and accepting it would break the policy without saying so.
- No per-category limit on concurrent uploads yet (backlog item 12). Each active chunk holds one 16 MB buffer.

### Proof (`make a-tus-check`, macOS, through Caddy)

| Check | Result |
| --- | --- |
| 1 GiB upload, connection dropped 6 MB into chunk 20 | server offset = chunk start + 6,000,000 (every received byte kept); upload finishes |
| SHA-256 of what was sent / receipt / downloaded bytes / `X-Content-SHA256` | all equal (`03ac97c0036e52c4...`) |
| `POST /verify` | `ok: true` |
| API heap capped at 160 MiB (`-Xmx160m`), same 1 GiB upload and download | passes, peak sampled heap 138 MiB, no `OutOfMemoryError` |
| Default heap | peak sampled 230 MiB (uncollected garbage; the capped run is the real bound) |
| `filegrid_upload_resumes_total{category="video"}` | 1 |
| No token / no `Tus-Resumable` / document category / unknown upload | `401` / `412` / `400` / `404` |

Unit tests: 31 new (83 in all). `TusServiceTest` runs the real upload logic on in-memory Postgres and S3 stand-ins
(the fake S3 rejects non-last parts under 5 MB, like the real one) with awkward chunk sizes, a dropped link, a
second replica taking over, a lost leftover, an S3 outage and expiry.

### Known edge

If S3 finishes the multipart upload and the database write that follows fails, the client's retry cannot complete
(S3 no longer has the upload). It needs a manual check of the object. Rare; not handled yet.

## Document encryption and audit log (branch `zone-a/encryption-and-audit`)

Backlog items 9 and 10. Both follow the policy file, not the category name: `encrypt: true` encrypts, `audit: true`
audits. Today that is `document` only.

### Encryption (AES-256-GCM, envelope)

- Every file gets its own random 256-bit data key and a random 7-byte `iv`. The data key is stored wrapped
  (AES-256-GCM, file id as authenticated data) under a key derived from `FILEGRID_MASTER_KEY`.
  `files.wrapped_key` = `0x01 | nonce(12) | sealed key(48)` (61 bytes; `0x01` is the master key version).
  `files.iv` = the 7 bytes. A wrapped key copied onto another row does not open.
- The file is sealed in 64 KiB segments, each AES-GCM, so upload and download stream with fixed memory.
  The segment nonce is `iv | segment number | last-segment flag`, and the file id is authenticated data. So a cut,
  extended, reordered or moved file fails authentication, not only a flipped byte.
- Encryption happens before the bytes reach any backend, so it holds for FTP, S3 and the database alike, including
  when an admin forces a storage. Storage is told the length of the ciphertext and a generic content type.
- `files.sha256` and `size_bytes` are of the ORIGINAL bytes (contract). The hash is taken while the bytes stream in,
  before encryption. On download the file is decrypted and hashed again, so the proof is the same as for a clear file.
  A failed decryption is reported exactly like a hash mismatch: `422 INTEGRITY_FAILED`, the metric, `status=corrupt`.
- `FILEGRID_MASTER_KEY` must be 64 hex characters or the API refuses to start. Files stored before a policy change
  keep the setting they were stored with (`files.encrypted`).
- File names stay in `files.original_name` in clear: search needs them. Only the bytes are protected.

### Audit log (hash chain)

- Table `audit_log` (contract). For a category with `audit: true`, these events are written: `file.write`,
  `file.read`, `file.read_denied` (integrity failure), `file.verify`, `file.metadata` (GET one file),
  `file.download_link`. Not audited: search results (`GET /files`).
- `hash = sha256(prev_hash + event_json)`. `event_json` is compact JSON with sorted keys:
  `action, actor, at, details, file_id`; `at` is microseconds since the epoch. The first row's `prev_hash` is 64 zeros.
  Details hold only category, storage, size, hash, result and flags: never a file name or content.
- Several replicas write at once, so each append takes a Postgres advisory lock for its transaction and reads the
  latest hash. A write's file row and its audit event commit in one transaction.
- **Fails closed.** A read is audited before the first byte is released; if the log cannot be written, the read is
  refused (`503`). If a write's event cannot be written, the upload is rolled back and its bytes removed.
- Append only: triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` (migration `V102`). The table owner can drop a
  trigger, which is why the chain exists: that edit breaks it. `make a-audit-check` recomputes the chain in Python,
  independently of the service. `AuditChainTest` pins one reference event and hash so the two cannot drift apart.
- Limit: a chain shows an edit or a removal in the middle, but if the newest rows are deleted the rest still verify.
  Catching that needs the latest hash copied somewhere else from time to time. Not built.

### Fix found while testing: files in the database never worked on the policy path

`stored_blobs.file_id` has a foreign key to `files`, but the blob was written before the `files` row (the hash is only
known after streaming), so every database write failed. The first PR's tests used fakes, and the meter path does not
use `DbStorage`, so it went unnoticed. Now `V103` makes the key check run at commit and a database file is written as
one transaction (blob + row + audit event). FTP and S3 files are written first and their row after, as before.

### Proof (`make a-doc-check TAMPER=1`, through Caddy)

| Check | Result |
| --- | --- |
| Document read straight from `stored_blobs` | no `PERSONAL-DATA` or `Popescu` in the bytes; length = original + 16 per segment |
| `files` row | `encrypted = t`, wrapped key 61 bytes, iv 7 bytes |
| Download / download link | identical bytes; `X-Content-SHA256` is the original's hash |
| One bit flipped in storage | `422 INTEGRITY_FAILED`, `filegrid_integrity_failures_total` 0 to 1, verify `actual=decryption-failed` |
| Bit restored | reads again |
| Audit events for the file | write, read, read_denied, verify, download_link all present, no name or content |
| Chain recomputed in Python | 8 rows OK; plain `UPDATE` refused |
| Trigger disabled, one row edited | chain breaks at that row; restored, verifies again |

Not proven live: the document on FTP. The zone B FTP image does not run on Apple Silicon, so the check uses the
database (admin `X-FileGrid-Force-Storage: db`). The encryption is the same for every backend (`FileServiceEncryptionAuditTest`).

Unit tests: 48 new (131 in all): `EnvelopeCryptoTest` (every size, flipped byte anywhere, cut at a segment boundary,
extra bytes, swapped segments, wrong file id, wrong or altered key, a 40 MB stream), `AuditChainTest`,
`FileServiceEncryptionAuditTest` (ciphertext in storage, audit before release, fail closed, rollback, transactions).

## Fallback storage, spool and circuit breaker (branch `zone-a/fallback-spool-breaker`)

Backlog items 13 and 15. Stop a storage and FileGrid keeps taking files, parks what it cannot place, and moves
it to the right storage once that storage is back.

### The circuit breaker

- One circuit per storage (db, s3, ftp), Resilience4j core, in `StorageGuard`. Every call to a backend goes through it.
  10 calls window, opens at 50 % failures after at least 3 calls, waits 10 s, then lets 2 trial calls through.
  Settings: `filegrid.breaker.*`.
- An open circuit answers at once and does not touch the backend. Reads of a file on that storage get `503`.
- **What does not count as a storage failure:** the client's connection breaking mid-upload (`ClientStreamException`),
  our own refusals, and data the database rejects as invalid. Otherwise a closed browser tab, or one bad request, could open
  a circuit. The request body is wrapped to tell the two apart (`TrackingInputStream`).
- Health probes (`StorageMonitor`, every 5 s) go through the same circuit. So a circuit opens within about 15 s of a
  storage dying, and closes by itself after it returns, with no user traffic. They publish `filegrid_storage_up`.
  `filegrid_circuit_open` is 1 until the circuit is fully closed (half-open counts as 1, or a dead storage would flap).
- Timeouts so a dead storage fails in seconds: database connect 3 s (`hikari.connection-timeout`), FTP connect 3 s,
  S3 with no hidden SDK retries. `GET /storages/health` reads the last probe and the live circuit; it never calls a backend.

### Writes

1. The policy's primary. If its circuit is open or the write fails, 2. the policy's `fallback`.
   The upload body is opened again for the fallback, so it gets the whole file even if the primary failed halfway.
2. The client is told "stored" only after the bytes are durable where they were written.
3. `X-FileGrid-Force-Storage` has no fallback (it exists to test one storage). Forcing `spool` is a `400`.
4. If the **database** is the one that is down, nothing can be recorded, so files get `503`. The database also holds the index.
5. Metrics: the write that landed on the fallback is `filegrid_ops_total{storage=<fallback>, outcome="fallback"}`;
   a failed attempt on the primary is `outcome="error"` on the primary. A call refused by an open circuit is not an error.

### The spool

- `SpoolStorage`: a directory on the `spool-data` volume, `<category>/<file id>`. Written to `.part`, forced to disk, then
  renamed, so a crash leaves a whole file or nothing. A parked file has a `files` row (`storage=spool`, `status=spooled`)
  and a `spool_items` row, committed together. It can be downloaded while parked, and it keeps its encryption.
- `SpoolReplayer` (every 5 s) takes due items, copies the bytes to the storage the policy named, points the row at it,
  then re-reads and hashes the copy the way a download does. Only a copy that verifies lets the spool file go. A bad copy
  puts the row back on the spool. A storage that is down, or whose circuit is open, is not attempted; the wait between tries
  grows from 10 s to 5 minutes. Several replicas can run it: the database hands each item to one of them.
- A file that fell back to **another storage** (outage to the database) stays there. Its row says where it lives.
  Moving it back is not built.
- **Meter readings** have their own spool (`MeterSpool`): the policy says meter falls back to spool, but the database is the
  meter primary, so the index cannot be a table. One small file per reading, named by a hash of the Idempotency-Key.
  When the database is down a reading is parked, and "accepted" is sent only after the file is on disk. A retry finds it
  and gets "duplicate". Replay inserts it with the same `ON CONFLICT DO NOTHING`, so no reading is stored twice.
  Readings the database will never accept go to `meter/rejected/` instead of blocking the rest.
- `filegrid_spool_pending{category}` is a cached number refreshed every few seconds.

### Container change

The spool volume was owned by `root` and the API runs as `app`, so nothing could ever be written to it. The image now starts
a small entrypoint as root that fixes the owner of the volume, then `su-exec`s to `app` (Java stays PID 1). This also repairs
volumes created before this change.

### Proof (`make a-fallback-check`, through Caddy, on the running stack)

This stops and restarts the seaweedfs and postgres containers, and always starts them again.

| Step | Result |
| --- | --- |
| ftp is down on this Mac, document upload | falls back to s3, encrypted, downloads identical |
| Stop S3 | circuit opens within a minute with no traffic; `/storages/health` shows s3 down |
| Outage file | 201, stored in the database (its fallback); downloads identical |
| Video | 201, parked in the spool, row `spooled`, file on the volume, downloads identical |
| Document with ftp and s3 both down | `503`, nothing lost |
| Gauges | `circuit_open{s3}` 1, `storage_up{s3}` 0, `spool_pending{video}` 1 |
| Start S3 | video moves to s3 on its own, `spool_pending` 0, spool item and file gone, same SHA-256 |
| Stop Postgres | 3 meter readings 201 `accepted`, a retry 200 `duplicate`, `spool_pending{meter}` 3, login still works |
| Start Postgres | spool empties, exactly 3 rows in `meter_readings`, none twice, accepted +3 duplicate +1 |

Unit tests: 73 new (204 in all): the breaker, `StorageMonitor`, `SpoolStorage`, the write path with fallback
(half-read upload, open circuit skipped, client disconnect, both down, forced storage), `SpoolReplayer`, `MeterSpool`,
`MeterService`, `MeterSpoolReplayer`.

### Not done

- Resumable (tus) uploads are not spooled: with S3 down they answer `503` and the client retries by itself. Spooling a
  half-received resumable upload and turning it into a multipart upload later is a different feature.
- The spool volume is shared by replicas on one host (compose). Replicas on separate hosts would need shared storage.
- No limit on the spool size; the spool is only checked for free space (64 MB) by its own health check.
- No alert rule on `spool_pending` for categories other than meter; that is zone B's.

## Policy hot reload and PUT /policy (branch `zone-a/policy-hot-reload`)

Backlog item 8. The Storage Lab's "Apply policy" calls `PUT /api/v1/policy`; this is what it needs.

### Routes (contracts/openapi.yaml, no contract change)

| Route | Who | Result |
| --- | --- | --- |
| `GET /api/v1/policy` | any logged-in user | the policy in force, with its `version` |
| `PUT /api/v1/policy` | **admin only** (`403` otherwise) | `200` the policy now in force; `400` with the reasons if it does not validate |
| `GET /api/v1/policy/history` | any logged-in user | applied versions, newest first: `{version, appliedAt, appliedBy, policy}` |

- The body is checked against the same schema as the file, as sent: an unknown key, a missing category, a `spool`
  primary or a wrong type is a `400`, not silently dropped.
- **The server numbers versions** (latest + 1). The `version` in the body is ignored, so "Apply" never fails on a stale number.
  Applying a policy equal to the one in force records nothing and returns it.
- The change is in force for the next request, on every replica within about 3 s. No restart.

### Where the policy lives

- `config/policy.yaml` is the starting point (and is mounted read-only). Every policy applied after that is a row in
  `policy_versions`; the newest row is the policy in force. Replicas check the table every 3 s.
- **A file edit while the API runs** is applied as a new version (`appliedBy: file`). A file that does not validate is
  logged and ignored: a typo cannot replace a working policy. Putting the file right again applies it.
- **After a restart the newest applied version wins over the file**, so a policy set through the API survives. A file
  edited while the API is stopped is not picked up if a newer version exists; edit it while the API runs, or use `PUT`.
- Several replicas: a Postgres advisory lock serialises version numbers, and a file edit seen by all of them is
  applied once (the others find nothing left to change).

### Audit

Every change is an `audit_log` event `policy.update` (actor, `from`, `to`, source `api` or `file`, and a list such as
`document.encrypt true->false`), written in the same transaction as the new version. If the event cannot be written the
policy is not changed. Events about a policy have no file id; the chain handles that.

### Proof (`make a-policy-check`, through Caddy)

| Check | Result |
| --- | --- |
| dispatch `PUT` / no token | `403` / `401` |
| unknown storage, unknown key, `spool` primary, body not JSON | `400`, and the policy in force is unchanged |
| outage file before / after `PUT outage.primary=db` | goes to s3 / the very next upload goes to db, no restart, downloads identical |
| same policy again; client sends `version: 999` | no new version; the server still numbers it next |
| history | newest first, `appliedBy` set |
| audit | `policy.update` events with no file id, saying `outage.primary s3->db`; chain verifies in Python |
| edit `config/policy.yaml` while running | applied within seconds as a new version from `file` |
| break the file | ignored, policy unchanged; putting it right applies it |
| restart the API after a `PUT` | still has the `PUT` policy, not the older file's |

`config/policy.yaml` is restored exactly by the script.

Unit tests: 37 new (241 in all): `PolicyManagerTest` (first start, restart, PUT, versions, no-change, invalid, audit failure rolls
back, other replica, file edit, broken file, retry), `PolicyWebTest` (who may do what), access rules, schema checks.

### Limits

- Only the policy values change at runtime. Worker pool and queue sizes do nothing yet: the per-category bulkheads (backlog item 12) are not built.
- A policy that sends a category to a storage that is down is accepted; the circuit breaker and the fallback handle it.
- Uploads already in flight finish under the policy they started with.

## Per-category queue limits, bulkheads (branch `zone-a/bulkheads`)

Backlog item 12. A storm in one category must not slow the others.

### How it works

- One limiter per category (`Bulkheads`). From the policy: `workers` writes run at once, `queue` more may wait, and anything
  beyond that is refused at once with **`503` `STORAGE_UNAVAILABLE` and `Retry-After: 2`**, naming only that category. A
  request that waits longer than 10 s (`filegrid.bulkhead.max-wait-seconds`) is refused the same way.
- It counts **writes**: `POST /files`, `POST /meter-readings`, and each tus chunk. Reads are not limited: one long download of a
  large video would hold one of video's 2 workers for minutes. tus creation is not limited (it is a quick call).
- The sizes are read from the policy on every entry, so `PUT /policy` ("Apply policy") changes them for the next request, with no
  restart. Changing `workers` upward lets waiting requests in at once.
- `filegrid_queue_depth{category}` (the name in `contracts/metrics.md`) is the number waiting.
- Waiting is cheap: requests run on virtual threads, and the limiter uses a lock and a condition, not `synchronized`, so a
  waiter does not pin a carrier thread. What the limit protects is storage and memory: each running tus chunk holds one part
  buffer, so a category's `workers` also bounds its upload memory.
- A refusal is not a storage failure: it never counts against a circuit, never triggers a fallback, and a refused meter reading
  is not parked (the meter retries it with the same key). The worker is given back even if the write fails.
- The database pool is 32 connections (`hikari.maximum-pool-size`), enough for the default workers (16 + 8 + 4 + 2) plus
  background jobs. A smaller pool would let one category's storm starve the others of connections and undo the isolation.
  With several replicas, keep `32 x replicas` under Postgres' `max_connections`.
- The refused request is **not** counted as `filegrid_ops_total{outcome="error"}`: that metric is per storage, and the storage
  did nothing wrong. See "Proposed for the contract" below.

### Proof (`make a-bulkhead-check`, through Caddy)

The script lowers outage to 2 workers and a queue of 4 with `PUT /policy`, fires 4 waves of 80 simultaneous outage uploads, and
at the same time sends meter readings and document uploads. It puts the limits back after.

| Check | Result |
| --- | --- |
| 80 outage uploads at once, default limits (8 workers, queue 500) | 80 stored, 0 refused |
| 320 outage uploads in waves, limits 2 / 4 | about 60 to 90 stored, the rest refused `503` with `Retry-After: 2`; nothing else went wrong |
| `filegrid_queue_depth{outage}` | rises to the limit (4 or fewer), never above it; 0 again after |
| `filegrid_queue_depth{meter}` and `{document}` | stayed 0 |
| Meter readings during the storm | hundreds to thousands accepted, none refused; p95 11 to 15 ms alone, 14 to 34 ms during the storm |
| Document uploads during the storm | all `201`, none refused |
| Files stored during the storm | download identical |

Honest reading of the meter latency: on this laptop the same burst under the generous default limits was not reliably worse
(p95 5 to 26 ms in two runs, one run 181 ms), because small uploads do not saturate anything. So these numbers show that the others
keep working at normal speed and that the storm is contained to its category, not that the limits made meters faster than
they would have been. The isolation itself is structural (separate workers and queue) and is covered by the unit tests.

For the demo: with the default limits a normal storm does not fill any queue. To show the queue depth rise, lower the
category's `workers` and `queue` with "Apply policy" first, as the script does.

### Proposed for the contract (not changed here)

`filegrid_bulkhead_rejected_total{category}` (counter): writes refused because a category was at capacity. Today a refusal shows
only as an HTTP 503 and a log line (at most one per category every 10 s). Zone B would need it for an "overload" alert. Raise it in
`contracts/metrics.md` if wanted.

Unit tests: 18 new (259 in all): concurrency never above the workers, queue and refusal, isolation between categories, wait
timeout, worker given back on failure, live resize, queue of 0, interrupted waiter, a burst of 200; and at the service level
(a full category is refused before any storage is touched, the others upload, tus chunk and meter reading) and HTTP level (`503`
plus `Retry-After`).

## Traces and logs end to end (OpenTelemetry)

One upload can be followed from the HTTP request down to the storage write, and its log lines are tied to the same trace.

### Spans (names and attributes are the ones in `contracts/metrics.md`)

| Span | When | Attributes |
| --- | --- | --- |
| `http <method> <route>` | every request (Spring's own, already there) | route template, status |
| `policy.route` | an upload or tus upload is routed | category, storage chosen, fallback storage, forced, encrypted, policy version |
| `storage.write` | each storage tried (one per attempt) | category, storage, file_id, size_bytes, fallback; marked error when it failed; `circuit_open` when the circuit refused it |
| `storage.read` | a download | category, storage, file_id, bytes read; ends when the stream closes |
| `integrity.verify` | the hash check on read-back | category, storage, file_id, `integrity_ok` |

The same spans exist for tus (one `storage.write` per part and one for the final join), for meter readings (`db`, or the spool
fallback) and for spool replay (`purpose=spool_replay`).

A failed primary shows as it happened: `storage.write` (error) on `s3`, then `storage.write` on `db`.

### Logs

- Console lines are JSON (ECS) with `trace_id` and `span_id` (renamed from Boot's camelCase to the contract's names).
- `category`, `storage` and `file_id` are added while the code runs inside that upload, in a span or not.
- The same lines (INFO and above) are sent over OTLP to the collector, then to Loki. They keep the trace id, span id, `category`,
  `storage` and `file_id`. Lines from before the exporter starts are buffered (500), not lost.
- Only the file id is logged. No file name and no content, in spans, console or Loki.

### Noise left out

No trace for `/api/v1/health`, `/api/v1/storages/health`, `/actuator/*` or scheduled jobs (replay, probes). Otherwise Tempo
would fill with one trace every few seconds.

### Proof (`make a-trace-check`)

| Check | Result |
| --- | --- |
| Upload, then ask Tempo for the receipt's `trace_id` | tree `http post /api/v1/files` > `policy.route` + `storage.write` |
| Same request in the API's JSON log | has `trace_id`, `span_id`, `category`, `storage`, `file_id` |
| Same request in Loki | found by `file_id` |
| Health checks, scrapes, jobs | no traces |
| seaweedfs stopped, then upload (skip with `NO_CHAOS=1`) | `storage.write` (error) on `s3`, then `storage.write` on `db` |
| File name in spans, console or Loki | not found |

To look by hand: Grafana, Explore, Tempo, paste the `trace_id` from the upload receipt. In Loki, search `{service_name="filegrid-api"}`
with the `file_id`.

Notes:

- If Tempo says `at least 1 live replicas required` (seen after the laptop slept), `docker compose restart tempo` fixes it. The
  collector retries, and spans sent in the gap can be lost.
- Spans are sampled by Boot's setting (`management.tracing.sampling.probability`); the demo keeps it at 1.0.

Unit tests: 38 new: span names and attributes, error marking, the log context put back after a scope, the noise
filter, the OTLP log appender (early buffer, trace mapping, its own lines skipped), and span trees in the file, tus, meter and
replay services.

## Large downloads: read once

Before, every download read the stored file twice: once to hash it (the first byte waited for that), and again to send it. That is
right for small files, because a corrupt file then gets a clean `422` before any body is sent. For a 1 GB video the wait is long.

| File size | How it is sent | A corrupt file gives |
| --- | --- | --- |
| up to `filegrid.download.verify-first-max-bytes` (64 MiB; env `FILEGRID_DOWNLOAD_VERIFY_FIRST_MAX_BYTES`) | hash first, then send (two reads) | `422 INTEGRITY_FAILED`, no body |
| larger | read once: the hash is built while the bytes go out | a transfer that stops short; no complete body |

Documents and outage files are far below the limit, so they keep the clean `422`. Only large video takes the single pass.

How the single pass stays safe:

- The stream always holds back its last chunk (64 KiB). When the stored object ends, the hash is compared **before** that chunk
  is released. If it differs, the chunk is never sent and the connection ends early. The client sees fewer bytes than
  `Content-Length`, so it cannot mistake the file for a good one. A client can also hash the bytes and compare them with the
  `X-Content-SHA256` header.
- Honest limit: the status line (`200`) and the earlier bytes are already out when the mismatch is found, so a `422` is not possible
  on this path. Encrypted files fail earlier: each 64 KiB segment is authenticated as it is read.
- The read is audited before the first byte, as `file.read` with `result=streaming`. A mismatch adds `file.read_denied` when it is found.
  The file is marked `corrupt`, `filegrid_integrity_failures_total` goes up, and the read counts as an error.
- Spans: `storage.read` ends when the client has the last byte; `integrity.verify` (`single_pass=true`) ends when the hash is compared.
- Memory: two chunks per download, whatever the file size.

### Proof (`make a-download-check`)

| Check | Result |
| --- | --- |
| 48 MiB file (hash first) | identical; first byte after about 0.1 s |
| 96 MiB file (single pass, uploaded with tus) | identical, `X-Content-SHA256` is the original's; first byte after about 0.02 s |
| 96 MiB file, recorded hash changed in Postgres | 100 597 760 of 100 663 296 bytes arrive (the last 64 KiB is held back), failure counted, file `corrupt` |
| Hash put back | the file reads again |

The first-byte gain is small here because the lab files are small and local. The hashing pass is a read of the whole file, so it
grows with the size: for 1 GB it is the time to read 1 GB from storage.

Unit tests: 13 new: the stream (sizes around the chunk, empty, corrupt, short file, early close, failed decryption, read-ahead
limit) and the service (one read for a large file, two for a small one, corrupt large file, missing file).

## Round from Zone C: what was already there, and what was added

Zone C's list (policy API, metrics, health, delete, bulkheads, Toxiproxy), item by item:

| # | Ask | State |
| --- | --- | --- |
| 1 | `PUT /api/v1/policy` (admin), hot reload, `policy_versions` row | Already merged (PR #25). Unchanged. |
| 2 | `filegrid_queue_depth{category}`, `filegrid_storage_up{storage}`, `filegrid_circuit_open{storage}` | Already merged (PR #22 and #28), checked on `/actuator/prometheus`. Unchanged. |
| 3 | `/storages/health`: 1 s probe timeout, 2 s cache | **New**, below. |
| 4 | `DELETE /api/v1/files/{id}` (admin, audited) | **New**, below. |
| 5 | Per-category bulkheads | Already merged (PR #28). Unchanged. |
| 6 | PG, S3 and FTP through Toxiproxy | **New** for Postgres and S3. FTP needs a change in Zone B's file, below. |

### `/storages/health`

- The page never calls a backend. It returns the last probe, and the probes now run every 2 s (before: 5 s). That is the 2 s cache.
- The three probes run side by side and each gets 1 s. One that has not answered by then counts as down. Before, one hanging probe
  (an S3 that accepts the connection and says nothing, about 9 s of client retries) held the others back and left all results stale.
- A probe that is still stuck is not started again, so a hung storage does not pile up threads.
- The S3 probe also carries a 1 s call timeout, so the call itself is cut and not only abandoned.
- Worst case: a storage is reported down about 3 s after it hangs, and about 3 s after it returns it is reported up.

### `DELETE /api/v1/files/{id}`

| Case | Answer |
| --- | --- |
| admin, file exists | `204`. The stored bytes are removed from the storage that holds them, then the row (a database blob and key material go with it). |
| any other role (also a meter device or a download link) | `403`, the file stays. |
| unknown id, or deleted twice | `404` |
| storage cannot be reached (circuit open or down) | `503`, the row stays, so no object is left with nothing pointing at it. Safe to repeat. |
| category whose policy audits (documents) | `file.delete` is written in the same transaction as the row removal. If the audit cannot be written, the file is not deleted (`503`). |

The audit rows of a deleted file are kept: `audit_log` has no foreign key to `files`, and the chain still verifies. A file still waiting
in the spool has its spool entries dropped first. Small race: a replay that already took that entry can still write the object to the
real storage after the row is gone (an orphan object, no row). `filegrid_ops_total` has no `delete` op because the contract lists only
`write`, `read`, `verify`.

### Toxiproxy

`services/filegrid-api/compose.yml` now sets `PG_URL=jdbc:postgresql://toxiproxy:15432/filegrid` and `S3_ENDPOINT=http://toxiproxy:18333`,
so a toxic on the `pg` or `s3` proxy slows or cuts the storage for real. Proof in `make a-ops-check`: a 400 ms toxic on `s3` moved an
outage upload from 0.02 s to 0.85 s, and a 300 ms toxic on `pg` moved a database read from 0.01 s to 0.32 s. `make a-fallback-check`
and a 100 MiB tus upload still pass through the proxy.

**FTP is not routed through the proxy yet.** I tried it: the control channel works, but a file transfer fails. vsftpd sends the data
over passive ports 30000 to 30009 and (`pasv_promiscuous=NO`) accepts a data connection only from the same address as the control
connection. With the control channel proxied, the data connection must be proxied too. A document then fell back to S3 (so the check
`a-doc-check` failed), which is why the default stays `ftp:21`.

Proposed for `infra/toxiproxy/toxiproxy.json` (Zone B's file, not changed here): ten more proxies, 
`{ "name": "ftp_pasv_3000N", "listen": "0.0.0.0:3000N", "upstream": "ftp:3000N", "enabled": true }` for N = 0 to 9. I created them by hand
for a test and `a-doc-check` passed through the proxy, then removed them. Once they are in, put `FILEGRID_FTP_HOST=toxiproxy` and
`FILEGRID_FTP_PORT=12121` in `.env` (no code change). Zone B's `chaos-control` would also need to put its toxic on those proxies for the
data to slow down; today it targets only `ftp`, which slows the control channel.

### Proof (`make a-ops-check`)

| Check | Result |
| --- | --- |
| field user deletes | `403`, file still there |
| admin deletes | `204`; metadata and content `404`; second delete `404` |
| file in the database | its blob row is gone |
| document | `file.delete` in the audit log, older rows kept, chain verifies |
| S3 hangs (`timeout` toxic) | `/storages/health` answers in 12 ms at the slowest; S3 reported down after 2.6 s |
| network back | S3 reported up again after 2 s |

Unit tests: 9 new: the monitor (a hung probe is down after 1 s and does not hold back the others, a stuck probe is not restarted,
`snapshot()` never waits), delete (bytes, row and audit together, no audit event for an unaudited category, audit failure refuses,
unreachable storage keeps the row, 404) and the access rule.

### Policy rule: the fallback must differ from the primary

`PUT /api/v1/policy` (and an edit of `config/policy.yaml`) now refuses a category whose `fallback` is its `primary`, with
`400 BAD_REQUEST` and `policy failed schema validation: $.categories.<category>.fallback: fallback must differ from primary`. Each
category that breaks the rule is named. A write that fails on a storage would only be retried on the same storage, so such a policy
has no fallback at all. The Storage Lab applied `document` as `s3`/`s3` before this and the API took it. The JSON schema cannot compare
two fields, so the check is in `PolicyService.validate`, which both the file and the API go through. The policy in force is not
changed by a refused request. `make a-policy-check` covers it. Unit tests: 3 new (service); 3 existing manager tests that
used `outage` `db`/`db` now use `ftp`.
