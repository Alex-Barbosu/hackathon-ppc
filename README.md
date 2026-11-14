# FileGrid

The single entry point for operational files at Rețele Electrice România (PPC group).
FileGrid receives smart-meter readings, substation outage records, customer connection
documents and drone inspection videos; decides from a per-category policy whether each goes
to **PostgreSQL, S3 or FTP**; proves every file comes back byte-identical; and measures
everything.

> Status: **in progress**. Every service boots behind the gateway and the meter simulator
> and dashboards are live; ingest, UI and chaos are being built in parallel by three zones
> (see [How we work](#how-we-work)). [Prove it](#prove-it) tracks what can be shown today.

## Quick start

You need **Docker** (Engine 24+ or Docker Desktop, with Compose v2.20+) and **make**.
Nothing else: no Java, Node or database on your machine. Allow about 4 GB of RAM for
Docker, and keep ports **80, 443 and 8443** free. On Windows, run the commands in WSL2.

```sh
git clone https://github.com/Alex-Barbosu/hackathon-ppc.git
cd hackathon-ppc
make up
```

`make up` checks Docker, writes `.env` with fresh random secrets on the first run, builds
every image, starts the stack and waits until every service reports healthy. The first run
downloads and builds images (a few minutes); later runs take about 30 seconds. It ends by
printing the URLs:

| URL | What |
| --- | --- |
| https://localhost | FileGrid web app |
| https://localhost/grafana | Opens on the **FileGrid Overview** dashboard (anonymous view; admin password in `.env`). Links at the top lead to the focused **Meters**, **Storages** and **Storm** dashboards |
| https://localhost/mock/api/v1/health | Mock of the whole API contract (Prism) |
| https://localhost:8443 | "Slow lane": the same gateway through Toxiproxy, for degraded-network demos |

The browser warns about the certificate once, because TLS comes from Caddy's local CA.
Run `make trust` and follow the printed command for your OS to trust it.

**Check it works:** `make ps` shows every service `Up (healthy)`, except `otel-collector`
(no shell in its image; Prometheus watches it instead). Open
https://localhost/grafana: in the **Smart meters** row, "sent" and "stored" climb at one
reading per second. Try `make b-profile P=peak` and watch the rate jump tenfold within
about 10 s. `make up` only returns once FileGrid itself reaches PostgreSQL, S3 and FTP.

| Command | Does |
| --- | --- |
| `make ps` | Service status |
| `make logs s=meter-simulator` | Follow one service's logs |
| `make b-rate R=20` / `make b-profile P=peak` | Change the meter volume live (`P=normal` to go back) |
| `make down` | Stop, keep data |
| `make reset` | Stop and delete all data (the next `make up` starts clean) |
| `make help` | Every target |

### Demo and rehearsal

| Command | What it shows |
| --- | --- |
| `make demo` | The storm story, step by step with a pause before each: baseline → outage storm ×10 (meter p95 stays flat) → stop S3 (outage falls back to the database, `StorageDown` fires), start it again and wait with a countdown until FileGrid sees it (about 30–50 s) → bad link on the slow lane → corrupt a file (download refused with 422, `IntegrityFailure` fires) → reset. Ctrl-C at any point undoes the chaos. |
| `make demo-scale` | 3 API replicas, a k6 outage storm with one replica taken out halfway (every upload still stored), a 256 MB drone video over a lossy link (resumed, byte-identical), back to 1 replica. |
| `make fresh-test` | The judges' path: clones the repo into a temp dir, runs `make up` from nothing, checks every route, login, one file per category byte-identical, closed ports, alerts quiet; then removes it. Run it before the deadline. `ARGS="--stop-running"` if a stack is already on port 443 (it is restarted afterwards). |

| `make b-trace` | One upload traced gateway → API → storage in Tempo, its log line in Loki, and a Grafana link to open it. |
| `make b-alert-check` | `StorageDown`, `MeterReadingLossRisk` and `IntegrityFailure` each fire, reach the narrator and resolve (about 12 min). |

`DEMO_AUTO=5 make demo` runs a demo unattended with 5 s pauses.

### Chaos buttons (demo)

Every `/chaos` call needs an admin JWT: from `POST /api/v1/auth/login` as `admin`, or
from `make b-token` (signed with the same secret, valid 8 h).

```sh
TOKEN=$(make -s b-token); H="authorization: Bearer $TOKEN"; J="content-type: application/json"
curl -sk -H "$H" https://localhost/chaos/state                                   # what is broken now
curl -sk -H "$H" -X POST https://localhost/chaos/storages/s3/stop                # or db / ftp, stop / start
curl -sk -H "$H" -H "$J" -d '{"target":"client","latencyMs":400,"lossPct":5}' https://localhost/chaos/network
curl -sk -H "$H" -H "$J" -d '{"category":"outage","multiplier":10,"durationSec":120}' https://localhost/chaos/storm
curl -sk -H "$H" -H "$J" -d '{"category":"video","multiplier":10,"durationSec":60}' https://localhost/chaos/storm   # 32 MB drone videos over tus
curl -sk -H "$H" -H "$J" -d '{"fileId":"<uuid>"}' https://localhost/chaos/corrupt   # flip a byte in storage
curl -sk -H "$H" -H "$J" -d '{"readingsPerSec":50}' https://localhost/chaos/meters
curl -sk -H "$H" -X POST https://localhost/chaos/reset                           # undo everything
```

`client` network conditions apply to the slow lane, https://localhost:8443. Port 443 stays
fast, so you can compare the two. `db`, `s3` and `ftp` degrade the link between FileGrid and
that storage (FTP's data connections included). Example: `{"target":"ftp","latencyMs":100}`
makes a 1 MB document take about 1.8 s instead of 0.15 s, still stored on FTP.

### Load tests

`make b-load S=baseline`, `S=storm-outage` or `S=video-lossy` runs a k6 scenario through
the gateway; results land in Grafana (Overview → *Load tests*). Details:
[loadtest/README.md](loadtest/README.md).

If `make up` fails: `make logs s=<service>` shows why; a port already in use (another web
server on 80/443) is the usual cause. `make reset && make up` starts over from scratch.

## Prove it

Each requirement, and the command or Grafana panel that proves it. "Overview" is the
dashboard at https://localhost/grafana. Rows marked *pending* name the zone delivering them.

### Gating requirements

| # | Requirement | Proof | Status |
| --- | --- | --- | --- |
| 1 | Store and retrieve all four categories | Upload and download one file per category in the web app | pending (A, C) |
| 2 | FTP, S3 and a database, each a separate service | `docker compose ps postgres seaweedfs ftp` shows three containers. With the default policy, a meter reading goes to `db`, an outage file to `s3`, a document to `ftp` (receipt field `storage`); Overview → *Every category on every storage* shows each | ✅ (video pending, A) |
| 3 | Policy configurable without code changes | Edit `config/policy.yaml` or `PUT /api/v1/policy`; next upload lands in the new storage | pending (A) |
| 4 | Retrieved file byte-identical, provably | `sha256sum` of the download equals the receipt's `sha256` and header `X-Content-SHA256`; `POST /api/v1/files/{id}/verify` returns `ok: true` | ✅ outage, document (video pending, A) |
| 5 | One command on a clean machine | `make fresh-test`: fresh clone → `make up` → 43 checks (routes, login, every category byte-identical, closed ports, alerts quiet), about 40 s with images cached | ✅ |
| 6 | UI to upload, search, download | https://localhost | pending (C) |
| 7 | Meters send continuously, configurable volume | Overview → *Smart meters*: "sent" follows the dashed "configured rate"; `make b-rate R=20` or `make b-profile P=peak` (10x) shows within 10 s | ✅ |
| 8 | Everything in Git | `git status` clean after `make up` (`.env` is generated and ignored) | ✅ |

### Non-functional requirements

| Area | Requirement | Proof | Status |
| --- | --- | --- | --- |
| Observability | p50/p95/p99, throughput, error rate per category × storage | Overview → *How long saves and downloads take* and *How much work, and how much of it fails* rows (matrix table + time series) | dashboard ✅, data pending (A) |
| Observability | One operation traceable request → storage | `make b-trace`: uploads one outage record and checks its trace in Tempo, `caddy /api` → `http post /api/v1/files` → `policy.route` → `storage.write`, plus its log line in Loki; it prints a Grafana link to that trace. Browse all such traces in [Grafana Explore → Tempo](https://localhost/grafana/explore?schemaVersion=1&orgId=1&panes=%7B%22a%22%3A%7B%22datasource%22%3A%22tempo%22%2C%22queries%22%3A%5B%7B%22refId%22%3A%22A%22%2C%22datasource%22%3A%7B%22type%22%3A%22tempo%22%2C%22uid%22%3A%22tempo%22%7D%2C%22queryType%22%3A%22traceql%22%2C%22query%22%3A%22%7Bresource.service.name%3D%5C%22caddy%5C%22%7D%20%26%26%20%7Bname%3D%5C%22storage.write%5C%22%7D%22%7D%5D%2C%22range%22%3A%7B%22from%22%3A%22now-1h%22%2C%22to%22%3A%22now%22%7D%7D%7D). On Overview's p50/p95/p99 charts, a dot is one sampled request: click it → *Query with Tempo* | ✅ |
| Observability | Alert when a business guarantee is at risk | `make b-alert-check` (about 12 min): stops S3 (`StorageDown`), stops the database (`MeterReadingLossRisk`), corrupts a document (`IntegrityFailure`); each fires, reaches the narrator, clears and sends a resolved notice. Last run: firing after 42 s, 70 s and 9 s; delivered about 10 s later. Rules: `infra/prometheus/rules/filegrid.yml`, tests: `make b-rules` | ✅ |
| Scalability | 10x spike in one category does not degrade others | `make b-load S=storm-outage` (outage ×10, 5 MB each, while documents keep their normal rate; k6 fails the run if documents slow down) or `POST /chaos/storm` (any category; video ×10 for 60 s: 30 of 30 videos stored, meter p95 under 12 ms); **FileGrid Storm** dashboard: meter save time stays flat, work waiting per category (`filegrid_queue_depth`) | ✅ |
| Scalability | Scale by adding instances | `make demo-scale`: 3 replicas share the load (Overview → *Work per FileGrid instance (scale-out)*); one taken out halfway through a storm, every upload still stored | ✅ |
| Scalability | Files > 1 GB with flat memory | `make b-load S=video-lossy VIDEO_MB=1100 LOSS_PCT=0 LATENCY_MS=0 JITTER_MS=0 BANDWIDTH_KBPS=0`: 1.1 GB uploaded and downloaded byte-identical; API memory stays far below the file size (`docker stats`) | ✅ |
| Security | Storages unreachable from outside | `for p in 5432 8333 9333 21; do nc -z -w 2 localhost $p && echo "$p OPEN"; done` prints nothing; only Caddy (80/443) and Toxiproxy (8443) publish ports | ✅ |
| Security | Authenticated access (chaos) | `curl -sk -o /dev/null -w "%{http_code}" https://localhost/chaos/state` → `401`; with `make b-token` → `200`; a non-admin JWT → `403` | ✅ |
| Security | TLS from outside | `curl -sI http://localhost` → `301` to https; `curl -vk https://localhost` shows TLS 1.3 | ✅ |
| Security | No secrets in the repo | CI runs gitleaks; `.env` is generated by `make up` from `.env.example` placeholders | ✅ |
| Security | Docker socket exposure | Only chaos-control mounts the socket (`grep -rn docker.sock infra/compose.yml services/*/compose.yml apps/web/compose.yml`). It touches only the `postgres`, `seaweedfs` and `ftp` containers of its own Compose project, runs as `node` with every capability dropped except SETUID/SETGID, and needs an admin JWT | ✅ |
| Resilience | Retries never duplicate meter readings | The simulator resends with the same `Idempotency-Key` and identical body (`make b-test`). After an outage, `docker compose exec postgres psql -U filegrid -d filegrid -c "select count(*), count(distinct (meter_id, period_start, seq)) from meter_readings"` shows equal numbers; Overview → *Smart meters*: "Readings stored" tracks "Sent" | ✅ |
| Resilience | Meter readings are never lost | `docker compose stop filegrid-api`: *Readings waiting for confirmation* grows; after `docker compose start filegrid-api` it drains to 0 and every generated reading is in `meter_readings`, also across a simulator restart | ✅ |
| Resilience | One storage down does not stop others | `POST /chaos/storages/s3/stop`: documents (ftp) and meter readings (db) still succeed; outage should fall back to `db` | chaos ✅, outage fallback pending (A) |
| Resilience | Transfers on lossy links finish or resume without manual action | `make b-load S=video-lossy`: 256 MB over 150 ms ± 50 ms and 20 % connection loss; every cut chunk resumes from the server offset, download byte-identical | ✅ |
| Resilience | Corruption detected on retrieval | `POST /chaos/corrupt {"fileId": …}` flips one byte directly in S3, FTP or PostgreSQL; the next download returns `422 INTEGRITY_FAILED` and `verify` returns `ok: false` | ✅ |

## Architecture

```
 Browser · meter simulator · k6
            │
   Toxiproxy slow lane (optional)
            │
   Caddy gateway: HTTPS, the only published ports (80, 443, 8443)
     /api → filegrid-api ×N   /chaos → chaos-control   /insights → insights
     /grafana → grafana       /mock → prism            / → web
            │
   filegrid-api: policy engine, integrity, encryption, per-category bulkheads
            │                         └── OTLP → collector → Prometheus · Loki · Tempo → Grafana
   ┌────────┼─────────┐                                      Alertmanager → insights
 PostgreSQL  SeaweedFS (S3)  FTPS        network `data` (internal, no route outside)
```

- **Storages are never published.** They live on an internal Docker network that only
  FileGrid services can reach.
- **No secrets in the repo.** `.env.example` holds placeholders; `.env` is generated and ignored.
- **Policy without code changes:** `config/policy.yaml`, validated by `contracts/policy.schema.json`.

## Repository layout

| Path | Zone | What |
| --- | --- | --- |
| `contracts/` | shared | OpenAPI, metric names, alerts, policy schema, DB tables. All three approve changes. |
| `services/filegrid-api/` | A | Spring Boot 3 / Java 21 ingest API |
| `config/` | A | Storage policy |
| `infra/` | B | Compose for storages, gateway, Toxiproxy, mock, observability |
| `services/meter-simulator/` | B | Simulated smart meters |
| `services/chaos-control/` | B | Live chaos actions for the demo |
| `loadtest/` | B | k6 scenarios |
| `apps/web/` | C | React 19 + Vite + Tailwind v4 web app |
| `services/insights/` | C | Claude grid analyst, incident narrator, Storage Lab, anomalies |

## How we work

Three people, each driving AI coding agents, work in parallel without merge conflicts:

1. **One zone per person, one zone per PR.** `CODEOWNERS` maps every folder to a zone; the
   CI zone guard fails a PR that touches two zones.
2. **Contracts first.** Anything crossing zones (endpoint, field, metric, table) is changed
   in `contracts/` in its own PR with the `contracts` label and all three approvals, then
   implemented. `make gen` regenerates the typed client.
3. **Mocks until real.** Build against `https://localhost/mock/...` until the other zone ships.
4. **Agent rules live in `CLAUDE.md` files**: the root one for everyone, plus one per zone.

Details: [docs/working-with-ai.md](docs/working-with-ai.md).
