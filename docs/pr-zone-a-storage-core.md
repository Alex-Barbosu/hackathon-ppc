# feat(a): storage core — adapters, policy routing, integrity, meter idempotency

Zone A P0 (backlog items 1–6): every category storable and retrievable, integrity-proven,
routed by `config/policy.yaml`. Edits confined to `services/filegrid-api/**`, `config/**`
(unchanged), `docs/a.md`. `contracts/` untouched.

## What this adds

- **StorageAdapter** (`write/read/delete/health`, all streaming — no whole-file buffering):
  `DbStorage` (bytea in `stored_blobs`), `S3Storage` (AWS SDK v2, path-style, `S3_ENDPOINT`,
  buckets `filegrid-<category>`), `FtpStorage` (FTPS explicit TLS, passive, `.part`→rename).
- **PolicyService**: loads `FILEGRID_POLICY_FILE`, validates against a bundled copy of
  `policy.schema.json`, routes by category (primary + fallback). No code change to re-route.
- **Endpoints per `openapi.yaml`**: `POST/GET /files`, `GET /files/{id}`,
  `GET /files/{id}/content`, `POST /files/{id}/verify`, `POST /meter-readings`, plus
  `GET /policy` and `GET /storages/health`.
- **Integrity**: SHA-256 via `DigestInputStream` in and out; download re-hashes and returns
  **422 INTEGRITY_FAILED** on mismatch, incrementing
  `filegrid_integrity_failures_total{category,storage}`.
- **Meter idempotency**: `ON CONFLICT (meter_id, period_start, seq) DO NOTHING`, ack only
  after commit; `201 accepted` then `200 duplicate`; `filegrid_meter_readings_total{result}`.
- **Metrics**: `filegrid.op.duration` (Timer, percentile histogram) → `filegrid_op_duration_seconds`,
  `filegrid.ops` (Counter) → `filegrid_ops_total`, tags `category, storage, op, outcome`;
  plus bytes/meter/integrity counters.
- **Auth** left open; `auth/AuthFilter` is the one-method seam to add JWT.

## Which gating requirement each change proves

| Requirement | Proven by |
| --- | --- |
| 1. Store & retrieve all four categories | `StorageAdapter` + `/files` upload/search/get/content, meters via `/meter-readings` |
| 2. FTP, S3 and a DB each really used | `DbStorage`, `S3Storage`, `FtpStorage`, selected by policy |
| 3. Policy configurable without code | `PolicyService` reads+validates `config/policy.yaml`; routing is pure data |
| 4. Byte-identical + provable | `DigestInputStream` both directions; `sha256` in receipt + `X-Content-SHA256`; 422 + metric on mismatch; `POST /verify` |
| NFR observability (metric names) | `FileGridMetrics` registers the `filegrid.*` base names → `metrics.md` Prometheus names |
| NFR resilience (meter exactly-once) | unique constraint + `ON CONFLICT DO NOTHING`, ack after commit, `filegrid_meter_readings_total{result}` |

## Verification

- `make a-test`: **11 tests pass, BUILD SUCCESS** (built in `maven:3.9-eclipse-temurin-21`;
  no host JDK on the build machine, same image as the Dockerfile). Includes the required
  PolicyService tests and the SHA-256-mismatch tests.
- `mvn -DskipTests package`: assembles `filegrid-api-0.1.0.jar`.
- Live `make up` + `curl -k` round trips and the Grafana `filegrid_ops_total` check are
  demo-time steps against zone-B's full stack; see `docs/a.md` for the status note. Run them
  on a host with the infra up (SeaweedFS buckets, FTPS, observability) before the demo.

## Contract changes

None.
