# Zone C — Experience and intelligence (web + insights)

> Read the root `CLAUDE.md` first. This file is your scope, backlog and rules.
> Owner: @Alex-Barbosu.

## Mission
Make FileGrid understandable: a premium, calm UI to upload, find and download files; an
operations view where judges watch every NFR hold under chaos; and an intelligence layer
that turns metrics and grid data into decisions (brief section 5). This is where the
demo is told.

## You may edit
`apps/web/**`, `services/insights/**` (migrations **V300–V399**, read-only views only),
`make/c.mk`, `docs/c.md`.

## You must not edit
`services/filegrid-api/`, `services/meter-simulator/`, `services/chaos-control/`, `infra/`,
`loadtest/`, `config/`, `Makefile`, root `compose.yml`, `README.md`, `contracts/` (only via contract PR).

## Stack
**web:** React 19, Vite, TypeScript strict, Tailwind v4 (`@import "tailwindcss"`, `@theme {}`
in CSS, `bg-linear-to-*`, never `tailwind.config.js`), TanStack Router + Query, Zustand,
Framer Motion (springs), Uppy with `@uppy/tus`, Recharts or visx for charts, MapLibre GL
for the outage map. API types generated from `contracts/openapi.yaml` (`openapi-typescript`).
**insights:** Node 22, TypeScript strict, Fastify, Anthropic TypeScript SDK, `pg` with the
read-only role, Prometheus HTTP API client.

## Design direction
Changed by Alex on 15 Nov 2026: FileGrid is a console for trained operators, not a landing page. Keep the
dark Origin tokens and fonts below, but no hero headlines, texture bands, explainer sections or phone
mock-ups inside the app. Screens open with the compact `PageHero` (breadcrumb label, 32 px title, one line),
sections use the small left-aligned `SectionTitle`, and density beats whitespace. Keyboard first:
`CommandPalette` (Ctrl/Cmd+K). `StatusBar` shows storage health on every screen. The analyst is "Volta"
(`features/insights/Volta.tsx`). Grafana is reachable from Operations (`GrafanaPanel`), the status bar and
each receipt's trace link (`lib/grafana.ts`). The 3D scene remains only as the Login backdrop.

Changed by Alex on 14 Nov 2026: the web app follows Origin (useorigin.com) closely. Dark ground
#050505, white as the only accent, colour for status only. Headings in Newsreader Light (300)
with one italic word; body in Inter Light; labels, nav and buttons in Roboto Mono capitals.
Cards 4% white with 0.8 px 8% borders and 24 px radius; widget panels #121212, 16 px radius.
Photography is replaced by our own rendered scenes: `src/three/` builds a transmission line
(lattice towers, sagging cables, cloud sky) in three.js; `GridScene` shows it live on Login, and
`npm run textures` (`tools/`, needs Playwright) renders the stills in `public/textures` (`tex-*`
utilities) from the same code. `PhoneFrame` is a layered CSS 3D phone that shows real FileGrid UI.
Motion goes through `components/motion` (`SPRING`, `Reveal`, `Stagger`, `Ticker`); reduced motion
is honoured everywhere, and the 3D scene falls back to its still. No AI tells: no glows, blobs or sparkles.
Tokens live in `src/index.css` `@theme`. Components under 80 lines, named exports, domain logic
in custom hooks, spring motion, AA contrast, visible focus rings.

## Screens
1. **Login** (demo roles).
2. **Upload**: drag-and-drop per category, tus progress with pause/resume and a visible "resumed after disconnect" state; receipt card with SHA-256 and storage badge.
3. **Library**: search/filter (category, region, date, text), download with live "verified ✓" or "integrity failed" state.
4. **Operations** (demo centrepiece): live tiles per category × storage (p95, throughput, errors), meter counter "sent = stored, 0 duplicates", storage health, queue depth; embedded Grafana panels where cheaper.
5. **Chaos panel**: buttons calling `/chaos` (kill/start storage, degrade network, storm ×10, corrupt file, meters rate, reset) with a timeline of what was triggered.
6. **Storage Lab**: run benchmark, matrix of category × storage (latency p95, throughput, error rate, cost note), recommended policy with reasons, "apply policy" (calls `PUT /api/v1/policy`).
7. **Insights**: AI briefing (normal vs peak day), meter anomalies list, outage hotspot map (Muntenia, Banat, Dobrogea), ask-the-analyst chat.
8. **Policy editor** (admin): form over the policy with schema validation and history.

## Backlog (in priority order)
### P0 — gating (done by 17:00, against the mock API)
1. App shell, auth, typed API client from OpenAPI, Upload (multipart for outage/document, tus for video), Library with search and download.
### P1 — NFR showcase (done by 21:00)
2. Operations screen reading Prometheus via insights (`/insights/metrics` proxy, or Grafana embeds).
3. Chaos panel.
4. Storage Lab runner in insights: uploads a fixed sample set per category to each storage using `X-FileGrid-Force-Storage`, collects timings from responses and Prometheus, stores results in `storage_lab_runs` (own table, V3xx), and computes a recommendation with explicit reasons.
### P2 — intelligence (done by 01:00)
5. **Claude grid analyst** (`POST /insights/ask`, SSE): tool-use loop with tools `query_prometheus(promql, range)`, `query_sql(view, filters)` (allowlisted views only, no free SQL), `get_trace(traceId)`, `get_storage_lab_result()`. System prompt: concise, numbers first, end with a recommendation and the confidence.
6. **Incident narrator** (`POST /insights/alerts`): for each firing alert, gather the alert, related metrics (last 15 min) and a sample trace, ask Claude (small/fast model) for a 3-line note: what is at risk, probable cause, next step. Show in UI feed and forward to the team webhook.
7. **Daily briefing** (`GET /insights/briefing`): normal vs peak comparison from metrics + Storage Lab, rendered on Insights.
### P3 — grid data
8. Meter anomalies: seasonal baseline per meter (same 15-min slot over previous days) + z-score; flags theft-like drops, stuck meters, voltage sags; Claude explains the top 3. Views: `v_meter_daily`, `v_meter_anomaly_candidates`.
9. Outage hotspots: counts and durations per county from outage metadata (COMTRADE fields when zone A extracts them), on the map.
10. PDF export of the briefing.

## AI rules (non-negotiable)
- Models: Claude Sonnet for the analyst, Claude Haiku for the narrator (`claude-sonnet-5-5`, `claude-haiku-5-5`; confirm current IDs with the `claude-api` skill at build time). Key from env `ANTHROPIC_API_KEY`, never in the repo or the browser.
- **No personal data to Claude:** tools expose only aggregates and meter/outage technical data. Document contents, names, ID numbers never enter a prompt.
- Tool outputs capped (rows, bytes) and summarised before they go into the context.
- Use prompt caching for the system prompt + tool definitions.
- If the API is unavailable at demo time, the UI falls back to the last cached briefing and says so.
- Every AI answer shows the numbers it used (source chips), so a judge can verify it.

## Acceptance checks you must be able to show
- Upload a 1 GB video, pull the network, plug it back: progress resumes from where it stopped.
- Download a corrupted file: the UI shows the integrity failure clearly.
- Chaos panel triggers each action and the Operations tiles react within seconds.
- Storage Lab produces a recommendation table with reasons, and applying it changes routing without a restart.
- Ask "How did today's storm compare with a normal day, and what should we change?" → a grounded answer with numbers.
- An alert produces a narrator note in under 30 s.

## Interfaces you provide / consume
- **Consume:** `/api/v1/*` (zone A), `/chaos/*` (zone B), Prometheus `http://prometheus:9090` (zone B), DB views on zone A's tables (`contracts/db.md`), Alertmanager webhook (zone B).
- **Provide:** `/insights/*` per `openapi.yaml`.

## Useful tools for your agent
- **Skills:** `claude-api` (built in: SDK, tool use, caching); author `insight-ui` (design tokens, component rules above) and `analyst-tools` (tool schemas + guardrails).
- **MCP:** Playwright MCP (drive and screenshot the UI), Grafana MCP (check PromQL before wiring it), read-only Postgres MCP (check views), Context7 (React 19 / TanStack / Tailwind v4 / Uppy docs), GitHub MCP.
- **Commands:** `make c-web` (Vite dev against mock or real API), `make c-insights`, `make up`.

## Later (do not build yet)
A domain knowledge corpus (e.g. transcripts of grid-operations content) will feed the
analyst for richer interpretation. Keep the analyst's tool layer pluggable so a
`search_knowledge(query)` tool can be added without refactoring.
