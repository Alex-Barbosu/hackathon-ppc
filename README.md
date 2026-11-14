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
| https://localhost/grafana | Opens on the **FileGrid Overview** dashboard (anonymous view; admin password in `.env`) |
| https://localhost/mock/api/v1/health | Mock of the whole API contract (Prism) |
| https://localhost:8443 | "Slow lane": the same gateway through Toxiproxy, for degraded-network demos |

The browser warns about the certificate once, because TLS comes from Caddy's local CA.
Run `make trust` and follow the printed command for your OS to trust it.

**Check it works:** `make ps` shows every service `Up` (most say `healthy`). Open
https://localhost/grafana: in the **Meters** row, "sent" and "acked" climb at one reading
per second. Try `make b-profile P=peak` and watch the rate jump tenfold within about 10 s.

| Command | Does |
| --- | --- |
| `make ps` | Service status |
| `make logs s=meter-simulator` | Follow one service's logs |
| `make b-rate R=20` / `make b-profile P=peak` | Change the meter volume live (`P=normal` to go back) |
| `make down` | Stop, keep data |
| `make reset` | Stop and delete all data (the next `make up` starts clean) |
| `make help` | Every target |

If `make up` fails: `make logs s=<service>` shows why; a port already in use (another web
server on 80/443) is the usual cause. `make reset && make up` starts over from scratch.

## Prove it

Each requirement, and the command or Grafana panel that proves it. "Overview" is the
dashboard at https://localhost/grafana. Rows marked *pending* name the zone delivering them.

### Gating requirements

| # | Requirement | Proof | Status |
| --- | --- | --- | --- |
| 1 | Store and retrieve all four categories | Upload and download one file per category in the web app | pending (A, C) |
| 2 | FTP, S3 and a database, each a separate service | `docker compose ps postgres seaweedfs ftp` shows three containers; Overview → *Category × storage matrix* shows traffic on `db`, `s3` and `ftp` | services ✅, traffic pending (A) |
| 3 | Policy configurable without code changes | Edit `config/policy.yaml` or `PUT /api/v1/policy`; next upload lands in the new storage | pending (A) |
| 4 | Retrieved file byte-identical, provably | `sha256sum` of the download equals header `X-Content-SHA256`; `POST /api/v1/files/{id}/verify` returns `ok: true` | pending (A) |
| 5 | One command on a clean machine | `make reset && make up` ends with every service healthy (`make ps`) | ✅ |
| 6 | UI to upload, search, download | https://localhost | pending (C) |
| 7 | Meters send continuously, configurable volume | Overview → *Meters*: "sent" follows the dashed "configured rate"; `make b-rate R=20` or `make b-profile P=peak` (10x) shows within 10 s | ✅ |
| 8 | Everything in Git | `git status` clean after `make up` (`.env` is generated and ignored) | ✅ |

### Non-functional requirements

| Area | Requirement | Proof | Status |
| --- | --- | --- | --- |
| Observability | p50/p95/p99, throughput, error rate per category × storage | Overview → *Latency* and *Throughput and errors* rows (matrix table + time series) | dashboard ✅, data pending (A) |
| Observability | One operation traceable request → storage | Simulator sends a W3C `traceparent` (one trace per reading, kept across retries); Tempo view in Grafana | partial, pending (A) |
| Observability | Alert when a business guarantee is at risk | Stop a storage; alert reaches the narrator within 2 min | pending (B, C) |
| Scalability | 10x spike in one category does not degrade others | Overview → *Meter write p95* stays green during an outage storm | pending (A, B) |
| Scalability | Scale by adding instances | `make scale N=3`; throughput spreads over replicas | pending (A) |
| Security | Storages unreachable from outside | `for p in 5432 8333 9333 21; do nc -z -w 2 localhost $p && echo "$p OPEN"; done` prints nothing; only Caddy (80/443) and Toxiproxy (8443) publish ports | ✅ |
| Security | TLS from outside | `curl -sI http://localhost` → `301` to https; `curl -vk https://localhost` shows TLS 1.3 | ✅ |
| Security | No secrets in the repo | CI runs gitleaks; `.env` is generated by `make up` from `.env.example` placeholders | ✅ |
| Security | Docker socket exposure | No container mounts `/var/run/docker.sock` today; chaos-control will be the only one, limited to an allowlist of storage containers | ✅ |
| Resilience | Retries never duplicate meter readings | The simulator resends with the same `Idempotency-Key` and identical body (`make b-test`); Overview → *Meters*: "Accepted by FileGrid" equals "Sent", retries appear only as "Duplicates rejected" | simulator ✅, server side pending (A) |
| Resilience | Confirmed readings are never lost by the sender | Stop the target (`docker compose stop mock-api`): *Unacked now* grows, then drains to 0 after `docker compose start mock-api`; unacked readings survive a simulator restart | ✅ |
| Resilience | One storage down does not stop others | `POST /chaos/storages/s3/stop`; other categories stay green | pending (A, B) |
| Resilience | Corruption detected on retrieval | `POST /chaos/corrupt`; download returns `422 INTEGRITY_FAILED` | pending (A, B) |

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
