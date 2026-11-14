# FileGrid

The single entry point for operational files at Rețele Electrice România (PPC group).
FileGrid receives smart-meter readings, substation outage records, customer connection
documents and drone inspection videos; decides from a per-category policy whether each goes
to **PostgreSQL, S3 or FTP**; proves every file comes back byte-identical; and measures
everything.

> Status: **base scaffold**. Every service boots and is wired through the gateway; features
> are being built in parallel by three zones (see [How we work](#how-we-work)).

## Quick start

Prerequisites: **Docker** (with Compose v2.20+) and **make**. Nothing else.

```sh
git clone https://github.com/Alex-Barbosu/hackathon-ppc.git
cd hackathon-ppc
make up
```

`make up` generates `.env` with fresh random secrets on first run, builds every image,
starts the stack and waits until every service is healthy.

| URL | What |
| --- | --- |
| https://localhost | FileGrid web app |
| https://localhost/grafana | Dashboards, logs, traces (anonymous view; admin password in `.env`) |
| https://localhost/mock/api/v1/health | Mock of the whole API contract (Prism) |
| https://localhost:8443 | "Slow lane": the same gateway through Toxiproxy, for degraded-network demos |

The first visit shows a certificate warning because TLS comes from Caddy's local CA.
Run `make trust` once to export the root certificate and trust it.

Other commands: `make ps`, `make logs s=<service>`, `make down`, `make reset` (wipe data),
`make scale N=3` (API replicas behind the gateway), `make help`.

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
