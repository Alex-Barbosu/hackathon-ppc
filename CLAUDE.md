# FileGrid — shared context (every agent reads this first)

> Every agent reads this file. Your zone's own rules are in the `CLAUDE.md` inside your
> zone's folders: `services/filegrid-api/` (A), `infra/` (B), `apps/web/` and
> `services/insights/` (C). Changing this file needs all three approvals.

## 1. What we are building

**FileGrid** is the single entry point for operational files at Rețele Electrice România
(PPC group: Muntenia, Banat, Dobrogea). It accepts four categories of files, decides
**where and how** each is written (FTP, S3 or a database) from a **per-category policy**,
**proves integrity**, and **measures everything**. Hackathon: 24 h, 3 people, all code
written by AI agents. Start Sat 14 Nov 2026 ~12:00 Bucharest; assumed deadline Sun 15 Nov 12:00.

| Category (slug) | Arrives via | Size | Volume | Business guarantee |
| --- | --- | --- | --- | --- |
| `meter` — smart meter readings | Pushed by the meter simulator | 1–50 KB | Very many, continuous | Never lost, never duplicated (billing) |
| `outage` — substation outage records | Uploaded in UI (dispatch) | 1–10 MB | Rare, 10x spikes in storms | Available to dispatch immediately |
| `document` — customer connection documents | Uploaded in UI | 0.1–10 MB | Moderate | Personal data protected, auditable |
| `video` — drone line inspections | Uploaded in UI (field teams) | 100 MB – 1 GB+ | Few, huge | Transfer survives slow/unstable links |

### Gating requirements (miss one = not evaluated)
1. Store **and** retrieve all four categories.
2. FTP, S3 and a database are each really used, each a separate service (S3 emulated locally).
3. Per-category policy is configurable **without code changes**.
4. Retrieved file is byte-identical to the stored one, and FileGrid can prove it.
5. Whole system starts on a clean machine with **one command**, following the README.
6. UI to upload, search and download the three manual categories.
7. Meter simulator sends readings continuously, with configurable volume (normal vs peak day).
8. All code, configs, scripts in Git before the deadline.

### Non-functional requirements (each must be shown LIVE at the demo)
- **Scalability:** a 10x spike in one category does not degrade others; scale by adding
  instances, no code change; files > 1 GB processed with flat memory (streaming).
- **Observability:** p50/p95/p99 latency, throughput, error rate per category × storage;
  one operation traceable from request to storage; automatic alert when a business guarantee is at risk.
- **Security:** storages unreachable from outside, FileGrid is the only door; TLS from outside;
  authenticated access; a direct storage breach does not expose personal data; no secrets in the repo.
- **Resilience:** one storage down does not stop other categories or lose confirmed files;
  transfers on high-latency lossy links finish or resume without manual action; retries never
  duplicate meter readings; corrupted files are detected on retrieval.

### Section 5 — statistics and interpretation
Answer, with data, for a decision maker: which storage fits each category and why; how a
peak day compared with a normal day; what the data says about the grid (meter anomalies,
outage hotspots). Useful interpretation beats chart count.

## 2. Architecture

```
 Browser (React)   Meter simulator   k6 storm
        \               |              /
         \              |             /
        Toxiproxy "slow lane" (optional, for lossy-link demos)
                        |
              Caddy gateway  — HTTPS, routes, the ONLY published ports
          /api → filegrid-api   /chaos → chaos-control
          /insights → insights  /grafana → grafana   / → web
                        |
          filegrid-api × N (stateless)  ── OTel ──> collector → Prometheus / Loki / Tempo → Grafana
          per-category bulkheads (queues + worker pools)          Alertmanager → insights (narrator)
                        |
          ┌─────────────┼──────────────┐   network "data" (internal: true)
      PostgreSQL     SeaweedFS (S3)   FTPS server
```

Docker networks: `edge` (caddy, toxiproxy), `app` (all services), `data` (`internal: true`:
storages + filegrid-api + insights read-only DB user). Only Caddy publishes ports (80, 443)
plus Toxiproxy's slow lane (8443).

### Default policy (hypothesis; Storage Lab confirms or changes it)
| Category | Primary | Fallback | Encrypt | Notes |
| --- | --- | --- | --- | --- |
| meter | db | spool | no | idempotency key, unique constraint, ack after commit |
| outage | s3 | db | no | high-priority pool |
| document | ftp | s3 | yes (AES-256-GCM) | `.part` write → verify → rename; audit log |
| video | s3 | spool | no | tus resumable, streamed to S3 multipart, 16 MB parts |

## 3. Tech stack (locked)

| Part | Choice |
| --- | --- |
| filegrid-api (zone A) | Java 21 + Spring Boot 3.x (virtual threads), Flyway, AWS SDK v2 (S3), Apache Commons Net (FTPS), tus-java-server. |
| web (zone C) | React 19 + Vite + TypeScript strict, Tailwind v4 (`@import "tailwindcss"`, `@theme {}` in CSS, no tailwind.config.js), TanStack Query, TanStack Router, Zustand, Framer Motion, Uppy (tus) |
| insights (zone C) | Node 22 + TypeScript + Fastify, Anthropic TypeScript SDK, `pg` read-only |
| meter-simulator, chaos-control (zone B) | Node 22 + TypeScript |
| Storages | PostgreSQL 17, SeaweedFS (S3 API), FTPS (vsftpd or pure-ftpd image) |
| Gateway | Caddy 2 (local CA TLS) |
| Observability | OpenTelemetry Collector, Prometheus, Loki, Tempo, Grafana, Alertmanager |
| Chaos / load | Toxiproxy, k6 |
| Run | Docker Compose v2 (`include:`), `make up` |

Do not introduce new languages, frameworks or services without a contract PR (see §6).
Supabase, MinIO and Kubernetes are out of scope for the default path.

## 4. Repo layout and zone ownership

```
hackathon-ppc/
├── CLAUDE.md               this file (base)
├── CODEOWNERS              base
├── compose.yml             base: ONLY include: lines — frozen
├── Makefile                B (zones add make/<zone>.mk)
├── .env.example            B (one file; ask zone B to add keys)
├── contracts/              SHARED — all three approve every change
│   ├── openapi.yaml
│   ├── metrics.md
│   ├── alerts.md
│   ├── policy.schema.json
│   └── db.md
├── services/
│   ├── filegrid-api/       A   (compose.yml, migrations V100–V199)
│   ├── meter-simulator/    B
│   ├── chaos-control/      B
│   └── insights/           C   (migrations V300–V399: read-only views)
├── apps/web/               C
├── config/policy.yaml      A
├── infra/                  B   caddy, storages, toxiproxy, otel, prometheus, grafana, loki, tempo, alertmanager
├── loadtest/               B   k6
├── make/                   a.mk (A), b.mk (B), c.mk (C)
└── docs/                   a.md, b.md, c.md; root README.md owned by B
```

**Zone A — Ingest core** (CalinCodes): the API, policy engine, storage adapters, integrity, crypto, auth, uploads.
**Zone B — Platform and reliability** (RORO123b): infra, one-command start, simulator, chaos, observability, alerts, load, CI, README.
**Zone C — Experience and intelligence** (Alex): web app, insights service (Claude analyst, narrator, Storage Lab, anomalies).

## 5. Contracts v0 (summary — `contracts/` is the source of truth once the base exists)

### Enums
- `Category`: `meter | outage | document | video`
- `Storage`: `db | s3 | ftp` (+ `spool` as a fallback location, never a primary)
- `Role`: `field | dispatch | connections | admin | meter-device`

### HTTP (all behind `https://localhost`, JSON, JWT bearer unless noted)
**filegrid-api — `/api/v1` (zone A)**
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | demo users from env → JWT with role |
| POST | `/files` | multipart, `category` field; outage/document ≤ 10 MB → `FileReceipt` |
| POST/PATCH/HEAD | `/files/tus/...` | tus 1.0 resumable, `Upload-Metadata: category, filename` → used for `video` (any category allowed) |
| GET | `/files` | search: `category, q, region, from, to, page, size` |
| GET | `/files/{id}` | metadata + receipt |
| GET | `/files/{id}/content` | streamed; verifies SHA-256 while streaming; header `X-Content-SHA256`; corruption → `422 INTEGRITY_FAILED` + metric |
| POST | `/files/{id}/verify` | re-hash in storage, returns `{ok, expected, actual}` |
| POST | `/meter-readings` | device token; body = reading file (JSON, 1–50 KB); header `Idempotency-Key: {meterId}:{periodStart}:{seq}` → `201 accepted` or `200 duplicate` |
| GET / PUT | `/policy` | current policy (validated by `policy.schema.json`); PUT = admin, hot-applied |
| GET | `/policy/history` | versions |
| GET | `/storages/health` | per storage: up, latency, circuit state |
| Header | `X-FileGrid-Force-Storage: db|s3|ftp` | admin only; used by Storage Lab benchmarks |

`FileReceipt = { id, category, storage, sizeBytes, sha256, storedAt, encrypted, traceId, signature }`

**chaos-control — `/chaos` (zone B, admin only)**
`GET /state` · `POST /storages/{db|s3|ftp}/stop|start` · `POST /network {target: client|db|s3|ftp, latencyMs, jitterMs, lossPct, bandwidthKbps}` ·
`POST /corrupt {fileId}` · `POST /storm {category, multiplier, durationSec}` · `POST /meters {readingsPerSec}` · `POST /reset`

**insights — `/insights` (zone C)**
`POST /ask` (SSE stream, Claude analyst) · `GET /briefing?from&to` · `POST /alerts` (Alertmanager webhook, internal only) ·
`POST /storage-lab/runs` · `GET /storage-lab/runs/{id}` · `GET /anomalies` · `GET /outage-hotspots`

### Metrics (emitted by zone A unless noted; Prometheus names)
| Metric | Type | Labels |
| --- | --- | --- |
| `filegrid_op_duration_seconds` | histogram | category, storage, op (`write|read|verify`), outcome |
| `filegrid_ops_total` | counter | category, storage, op, outcome (`ok|error|fallback`) |
| `filegrid_bytes_total` | counter | category, storage, direction (`in|out`) |
| `filegrid_queue_depth` | gauge | category |
| `filegrid_meter_readings_total` | counter | result (`accepted|duplicate|rejected`) |
| `filegrid_integrity_failures_total` | counter | category, storage |
| `filegrid_spool_pending` | gauge | category |
| `filegrid_storage_up` | gauge | storage |
| `filegrid_circuit_open` | gauge | storage |
| `meter_sim_sent_total`, `meter_sim_acked_total`, `meter_sim_retries_total` | counter (B) | region |

Every request carries a W3C `traceparent`; logs are JSON with `trace_id`, `category`, `storage`, `file_id`.

### Alerts (rules in zone B; webhook consumed by zone C)
`MeterReadingLossRisk` · `MeterIngestLatencyHigh` · `OutageAvailabilityDegraded` · `DocumentProtectionFailure` ·
`VideoTransferStalling` · `StorageDown` · `IntegrityFailure`. Payload = standard Alertmanager webhook v4.

### Database (owned by zone A; zone C reads only through views)
`files`, `meter_readings` (raw file + parsed fields, unique `(meter_id, period_start, seq)`),
`meter_intervals`, `idempotency_keys`, `audit_log` (hash-chained: `prev_hash`, `hash`),
`policy_versions`, `spool_items`, `stored_blobs` (bytea for db storage). Full columns in `contracts/db.md`.

### Policy file (`config/policy.yaml`, schema in `contracts/policy.schema.json`)
```yaml
version: 1
categories:
  meter:    { primary: db,  fallback: spool, encrypt: false, maxSizeMb: 1,     priority: high,   workers: 16, queue: 5000 }
  outage:   { primary: s3,  fallback: db,    encrypt: false, maxSizeMb: 20,    priority: high,   workers: 8,  queue: 500 }
  document: { primary: ftp, fallback: s3,    encrypt: true,  maxSizeMb: 20,    priority: normal, workers: 4,  queue: 200, audit: true }
  video:    { primary: s3,  fallback: spool, encrypt: false, maxSizeMb: 5000,  priority: low,    workers: 2,  queue: 20, chunkMb: 16 }
```

## 6. Rules for every agent

1. **Stay in your zone.** Only create or edit files in the folders your zone file lists.
   CI fails any PR that touches another zone. If you need something from another zone,
   write it down as a request for your human; do not edit their files.
2. **Contracts first.** Need a new endpoint, field, metric or table? Propose a change to
   `contracts/` in its own small PR, get all three humans to approve, merge, regenerate
   clients, then write code. Never change a contract silently.
3. **Build against mocks.** Until the real service exists, use the Prism mock of
   `openapi.yaml` at `https://localhost/mock/...` (same paths, `/mock` prefix). Switching to real = one env var or base URL.
4. **Never commit secrets.** Only `.env.example` with placeholders; `make up` generates `.env`.
5. **`make up` on `main` must always work.** Run it before opening a PR.
6. **Small PRs, often:** branch `zone-x/<feature>`, PR to `main` every 1–2 h.
7. **Commits:** Conventional Commits with the zone scope, e.g. `feat(a): stream tus uploads to S3`.
8. **Personal data never leaves the system.** No document content, names or ID numbers in
   logs, metrics, traces or any external API call (including Claude).
9. **Explain WHY in comments**, not what. TypeScript strict, no `any`. Java: records, no Lombok magic.
10. **Every feature names the requirement it proves** (e.g. "NFR resilience: retries never duplicate") in its PR description, so the demo script can cite it.

## 7. Definition of done for the whole system
A judge clones the repo, runs `make up`, opens `https://localhost`, logs in, uploads one
file per category, downloads each with a matching SHA-256, and watches Grafana stay green
while we kill a storage, fire a storm, degrade the network and corrupt a file.

## 8. Everyday commands
`make up` (start / rebuild everything) · `make ps` · `make logs s=<service>` · `make gen`
(regenerate API types after a contract change) · `make test` · `make reset` (wipe data) ·
`make help` (all targets, including your zone's `a-*`, `b-*`, `c-*`).

## 9. Later (not yet)
A domain knowledge corpus (e.g. transcripts of grid-operations content) will be added to
power richer data interpretation in zone C. Do not build for it yet; keep the insights
service's retrieval layer pluggable.
