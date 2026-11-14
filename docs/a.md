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
