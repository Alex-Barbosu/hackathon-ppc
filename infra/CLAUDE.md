# Zone B — Platform and reliability

> Read the root `CLAUDE.md` first. This file is your scope, backlog and rules.
> Owner: @RORO123b.

## Mission
Make FileGrid provable: one command starts everything on a clean machine, storages are
locked away behind the gateway, every NFR is measurable on Grafana, alerts fire when a
business guarantee is at risk, and the demo's chaos buttons actually break things on cue.

## You may edit
`infra/**`, `services/meter-simulator/**`, `services/chaos-control/**`, `loadtest/**`,
`Makefile`, `make/b.mk`, `.env.example`, `README.md`, `docs/b.md`, `.github/workflows/**`, `scripts/**`.

## You must not edit
`services/filegrid-api/`, `services/insights/`, `apps/`, `config/`, root `compose.yml`
(frozen include list), `contracts/` (only via contract PR).

## Stack
Docker Compose v2 with `include:`, Caddy 2, PostgreSQL 17, SeaweedFS (`weed server -s3`),
FTPS (vsftpd or pure-ftpd image with TLS), Toxiproxy, OpenTelemetry Collector, Prometheus,
Loki, Tempo, Grafana (provisioned dashboards as JSON), Alertmanager, k6.
Simulator and chaos-control: Node 22 + TypeScript strict + Fastify.

## Backlog (in priority order)
### P0 — gating (done by 17:00)
1. `infra/compose.yml`: postgres, seaweedfs (+ bucket init job), ftps, caddy; networks `edge`, `app`, `data` (`internal: true`). **No `ports:` on any storage.** Healthchecks on everything; `depends_on: condition: service_healthy`.
2. `make up`: checks Docker, generates `.env` from `.env.example` with random secrets (`openssl rand`), runs `docker compose up -d --build --wait`, prints the URLs. `make down`, `make reset` (wipe volumes), `make logs`.
3. Caddy: `https://localhost` with internal CA (`tls internal`), routes `/api/*`, `/chaos/*`, `/insights/*`, `/grafana/*`, `/` → web. HTTP → HTTPS redirect.
4. **Meter simulator v1**: N virtual meters across Muntenia/Banat/Dobrogea counties, each sends a reading file (JSON, 1–50 KB: meter id, region, county, lat/lon, 15-min intervals kWh, voltage, flags) to `POST /api/v1/meter-readings` with `Idempotency-Key`. Config by env and live via `POST /chaos/meters {readingsPerSec}`. Retries with exponential backoff + jitter, **same key on retry**. Exposes `meter_sim_*` metrics. Profiles: `normal`, `peak` (10x).
5. README "Quick start" that a stranger can follow (prereqs: Docker + make; nothing else).

### P1 — observability and chaos (done by 21:00)
6. OTel Collector receiving OTLP from all services → Prometheus (metrics), Loki (logs), Tempo (traces). Exemplars on so a latency spike links to a trace.
7. Grafana provisioned dashboards: **FileGrid Overview** (p50/p95/p99, throughput, error rate per category × storage — matrix panels), **Meters** (sent vs acked vs stored, duplicates rejected, retries), **Storages** (up, circuit, latency), **Storm** (queue depth per category). Anonymous viewer access via Caddy-authenticated route.
8. Toxiproxy: proxies `client-slowlane` (published 8443 → caddy:443) and internal `pg`, `s3`, `ftp` proxies that filegrid-api uses (so we can degrade one storage). Seed config at startup.
9. **chaos-control service** per `openapi.yaml`: stop/start storage containers (Docker socket, mounted read-write **only** into this container; allowlist of container names), set Toxiproxy toxics, corrupt a file (flip bytes directly in SeaweedFS/FTP/DB by file id), storm (spawn k6 or internal burst), meters rate, reset, state. Admin JWT required.

### P2 — alerts, load, scale (done by 01:00)
10. Prometheus alert rules for each name in `contracts/alerts.md`, tied to the business table, e.g. `MeterReadingLossRisk`: `meter_sim_sent_total - meter_sim_acked_total` gap growing for 1 m or `filegrid_spool_pending{category="meter"} > 0` for 2 m. Alertmanager → webhook `http://insights:8070/insights/alerts` + a Discord/Slack webhook from env (optional).
11. k6 scenarios: `storm-outage.js` (10x outage uploads, 5 MB files), `video-lossy.js`, `baseline.js`. Results pushed to Prometheus remote write.
12. Scale-out: filegrid-api has no `container_name`, Caddy load-balances across replicas (`lb_policy round_robin`, dynamic upstream via Docker DNS). `make scale N=3` demo.
13. CI (GitHub Actions): build all images, gitleaks, **zone guard** (fail if PR changes files outside the author's zone per CODEOWNERS unless label `contracts`), `docker compose config` validation.

### P3 — polish
14. Clean-VM rehearsal script (`scripts/fresh-clone-test.sh`) and a recorded backup demo.
15. `make demo` runs the full storm story: baseline → storm → kill S3 → degrade → corrupt → reset.
16. Optional `make up-k8s` on k3d with an autoscaler — only after everything else is green.

## Acceptance checks you must be able to show
- Fresh clone on a clean machine → `make up` → all healthy in < 3 min.
- `nc localhost 5432` / FTP port / S3 port from host: refused. Only 80/443/8443 open.
- Grafana shows p50/p95/p99 per category × storage; clicking a slow point opens its trace in Tempo.
- `make demo` storm: meter p95 stays flat while outage queue depth spikes.
- An alert fires within 2 minutes of killing PostgreSQL, and reaches the narrator.
- `git log -p | gitleaks` clean.

## Interfaces you provide / consume
- **Provide:** env vars for storages (names in zone A file), Grafana at `/grafana`, Prometheus API at `http://prometheus:9090` (zone C reads it), Alertmanager webhook payloads, `/chaos` API.
- **Consume:** metric names from `contracts/metrics.md`; health endpoints of each service.

## Useful tools for your agent
- **Skills (to author):** `compose-fragment` (how a zone adds its own compose file and env keys), `grafana-dashboard-as-code` (panel conventions, units, colours).
- **MCP:** Grafana MCP (`grafana/mcp-grafana`) to query Prometheus/Loki and check dashboards; Docker MCP or plain shell for containers; Context7 for SeaweedFS/Caddy/k6 docs; GitHub MCP.
- **Commands:** `make up`, `make logs s=<service>`, `make demo`, `make fresh-test`.

## Gotchas
- `internal: true` networks have no internet: images must be built before; bucket init runs on `data` network.
- Docker Desktop on macOS/Windows: Toxiproxy and Caddy work, but use `host.docker.internal` nowhere — everything by service name.
- Caddy local CA: browsers warn once; document `make trust` (runs `caddy trust` inside the container and exports the root cert).
- Keep the Docker socket out of every container except chaos-control, and say so in the README (security judges will ask).
