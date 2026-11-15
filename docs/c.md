# Zone C — Experience and intelligence

Zone notes, decisions and demo evidence go here. The agent rules are in this zone's `CLAUDE.md`.

## Web: Upload and Library (P0 item 1)

- API base: `VITE_API_BASE` (default empty = the real gateway, same origin). Set `VITE_API_BASE=/mock` to work against the Prism mock.
  Requests use `openapi-fetch` typed from `src/api/schema.d.ts`; the bearer token comes from `state/session.ts`
  (placeholder until the Login screen lands).
- Upload: outage/document use multipart `POST /api/v1/files`; video uses Uppy + `@uppy/tus` with 16 MB chunks and
  automatic retry. "Resumed after disconnect" is driven by tus-js-client's `onShouldRetry` (Uppy emits no event for it).
- Library: `GET /api/v1/files` filters; download shows "Verified" or, on `422`, an integrity-failed state.
- Known limit: Library download buffers the file as a Blob so the bearer header can be sent. Fine for outage and
  documents; a 1 GB video download needs a signed-URL or cookie-auth contract change (request for zone A).

## Web: Login and streamed downloads

- Login: `POST /api/v1/auth/login`; the `Session` lives in Zustand, persisted to `sessionStorage` (cleared when the tab
  closes). `Authorization: Bearer` is added to every `openapi-fetch` call, the buffered download and Uppy/tus requests
  from one place (`authHeaders()` in `api/client.ts`). A 401 on an authorised request clears the session and returns to Login.
  Expiry is not checked client-side (the mock returns a 2019 `expiresAt`); the server decides.
- Downloads: video, and anything over 50 MB, call `createDownloadLink` and then use a plain anchor to the returned
  60 s URL, so the browser streams to disk. Smaller files still use the buffered fetch so a 422 shows as "Integrity failed".
  For streamed files the UI shows the expected SHA-256; a mid-stream failure appears as a failed browser download.
- Status on `main` (193e3c8): zone A has no `/auth/login` or `/files/{id}/download-link` yet (the API answers 500),
  so Login and streamed download were verified against the mock only. Upload and search work against the real API.

## Insights: knowledge corpus (for the analyst's `search_knowledge` tool)

- `services/insights/corpus/`: 16 expert-sourced chunks for brief section 5 (reliability indices and
  Romanian SAIDI yardsticks, Major Event Days, smart meter anomalies, load shape, SRE alerting,
  latency measurement, storage fit). Sources and licence notes in `corpus/SOURCES.md`.
- `src/knowledge.ts`: `loadCorpus()` + `searchKnowledge(chunks, query, {answers})`, a keyword scorer.
  Wire it as the analyst tool `search_knowledge(query)`; return chunk ids so answers can show source chips.
- YouTube transcripts: run `corpus/tools/fetch_transcripts.py` locally; output is gitignored (third-party content).

## Operations and chaos dock (round 2)

- Route `/operations` replaces the placeholder; `/chaos` redirects to it. PromQL lives in
  `apps/web/src/features/operations/prom.ts`, read through Grafana's datasource proxy
  (`/grafana/api/datasources/proxy/uid/prometheus/api/v1`), refetched every 5 s.
- Storage strip polls `/api/v1/storages/health` every 3 s. For admins it also reads the chaos state,
  so a stopped container shows as Down as soon as the action returns (24 ms in the run below).
- Evidence (14 Nov, real stack): stop S3 -> strip Down 24 ms after the call returned; outage storm x10 ->
  outage writes rose to ~5/s while meter p95 stayed at 7 ms. Screenshots: `apps/web/screenshots/operations/`.

### Requests to other zones
- **Zone A:** `/storages/health` blocks ~9 s per call while S3 is down (probe timeout). Use a 1 s probe
  timeout. `filegrid_queue_depth`, `filegrid_storage_up` and `filegrid_circuit_open` are not emitted yet;
  the UI falls back to outage write rate for the hero chart.
- **Zone B:** a local `.env` generated earlier still has `METER_TARGET_URL=http://mock-api:4010/...`, so the
  simulator never reached the real API. `.env.example` is correct; `make up` does not repair an existing `.env`.

## Storage Lab (round 3)

- insights: `V301__storage_lab.sql` (`insights.storage_lab_runs`), `src/storageLab/*`. `POST /insights/storage-lab/runs`
  (admin JWT required, 202), `GET .../runs/latest`, `GET .../runs/{id}`. The run mints a 5-minute admin JWT per call
  (same claims as zone A's `JwtService`) and never logs it. Samples are streamed, so a 100 MB video sample is not buffered.
- Method: outage 5 MB, document 2 MB, video 100 MB (at most 3 samples). Multipart with `X-FileGrid-Force-Storage`, except
  video on S3, which goes through tus. Every sample is downloaded and its SHA-256 compared. A receipt that names a
  different storage than the one forced counts as an error, so a silent fallback never credits a storage with another's speed.
- Recommendation (`recommend.ts`): candidates with 0 errors and verified integrity are scored
  0.4 write p95 + 0.2 read p95 + 0.4 throughput, each relative to the best candidate, plus a 0.25 bonus for the storage with a
  fixed fit (documents: FTPS audit trail, video: S3 multipart, meters: PostgreSQL de-duplication). Each reason cites the numbers.
- Evidence (14 Nov, real stack, samplesPerCell=5, about 40 s): full 3x3 matrix. S3 won outage (write p95 ~160 ms vs 250 ms db),
  documents and video. FTPS lost documents despite its fit bonus (write p95 ~370 ms, 6.9 MB/s vs S3 80 ms, 27.5 MB/s).
- Benchmark files stay in the Library (description "storage-lab benchmark"); there is no delete endpoint.

### Requests to other zones
- **Zone A:** `PUT /api/v1/policy` does not exist, so "Apply policy" stays disabled. tus ignores `X-FileGrid-Force-Storage`
  (S3 only), and multipart caps at 64 MB, so video on PostgreSQL and FTPS cannot be measured at 100 MB (both recorded as
  `413 TOO_LARGE`). A delete endpoint (admin) would let the Lab clean up after itself.
- **Contract proposal** (needs all three approvals): extend `StorageLabCell` with `write`/`read` latency objects,
  `readMBps`, `errors`, `errorSamples`, `integrityOk`, `status`, `completed`, `sizeBytes`, `method`; extend the recommendation
  with `reasons[]`, `evidence[]` (label/value), `benchmarked`; add `GET /insights/storage-lab/runs/latest`. The web uses
  local types until then.

## Policy guardrails and the meter integrity card

- `validatePolicyChange(current, proposed)` (`apps/web/src/features/lab/policyGuard.ts`) blocks a change when a storage
  would be the primary of no category (brief gating 2), when any fallback equals its primary, or when meters leave
  PostgreSQL. Apply stays disabled and the preview lists the problems; nothing is sent.
- insights applies the same coverage rule when it recommends: if the per-category winners leave a storage unused, the
  category that loses least takes it, and the reason names both storages, e.g. "S3 was faster for documents (write p95
  81 ms vs 189 ms on FTPS), but documents stay on FTPS: ... and the brief requires every storage to be in use."
- Meter integrity: "stored" is only `filegrid_meter_readings_total{result="accepted"}`; with no such series the card says
  so and never uses the simulator's acks.
- **Known limit:** the API and the simulator are scraped separately every 5 s, so while the simulator runs at 1 reading/s
  the two counters differ by a few readings at random moments and the card shows "≠". At rest (`POST /chaos/meters` with
  0) they are equal. Options: a tolerance of rate x scrape interval, or pausing readings for the demo's proof moment.

## Meter integrity compares a window (round 4)

- The card compares `increase(...[10m])` of `meter_sim_acked_total` (all acks: each reading ends with exactly one) with
  `increase(filegrid_meter_readings_total{result="accepted"}[10m])`; duplicates rejected is the API's `duplicate` increase.
  Values are rounded to whole readings. Lifetime totals are gone: after a restart they disagree for no real reason (measured
  live: lifetime 1250 acked vs 117 stored, window 600 vs 597).
- `promql.test.ts` runs the card's own query strings through `promtool` (the Prometheus image) against input series with a
  counter reset on either side, a real gap, and the old lifetime totals as a contrast. It skips when the image is absent.
- **Known limit:** Prometheus only sees counter increments at scrape time, so readings the old process accepted after its last
  scrape before a restart never reach the counter. After restarting the API the card showed 600 vs 597 for the next 10 minutes
  while the database held exactly 600 distinct readings. A shorter window heals faster; a tolerance or a database-side count
  would remove it.

## Intelligence layer (round 5)

Code in `services/insights/src/intelligence`, migration `V302`, web in `features/insights` and `operations/AlertFeed`.

- **Narrator** (`POST /insights/alerts`, `GET /insights/incidents`): stores every alert once per (fingerprint, start), then a
  background queue (2 at a time) asks `NARRATOR_MODEL` (default `claude-haiku-5-5`) for two sentences. The model sees only
  allowlisted label values and scrubbed annotation text, plus a few numeric metrics for the alert's category and storage. Label
  values are validated before they reach PromQL. Caddy already answers 404 for this path from outside; the handler also refuses any
  request that carries forwarding headers.
- **Briefing** (`GET /insights/briefing`): facts are gathered from Prometheus, the views and the latest Storage Lab run, then
  `ANALYST_MODEL` writes the three Section 5 parts as structured JSON. Any metric chip that is not an exact copy of a gathered fact
  is dropped. Cached 30 minutes per hour-bucketed period; concurrent requests share one call. If the AI is off, over budget or
  failing, the last written briefing is served (`cached: true`), else a plain version built straight from the facts.
- **Analyst** (`POST /insights/ask`, SSE): bounded tool loop (6 calls) over `query_prometheus`, `query_view` (four aggregate
  views, parameterised), `get_storage_lab_result` and `search_knowledge` (returns nothing until a corpus is plugged in via the
  `KnowledgeSearch` interface; `ANALYST_KNOWLEDGE=corpus` enables the existing chunks). Tool output is capped at 3,500 characters.
  System prompt and tool definitions carry `cache_control`. The question is scrubbed before it is sent. Any failure ends in the
  cached briefing.
- **Anomalies and hotspots** come from `insights.v_meter_anomaly_candidates` (leave-one-out z-score per meter and 15-minute slot,
  stuck run, voltage below 207 V) and `insights.v_outage_by_county`. `meter_intervals` is empty today, so anomalies are `[]`; the
  view was checked against synthetic rows in a rolled-back transaction. Hotspots (V303) count outage records per county, which
  dispatch picks on the Upload page, and name the top stations and the latest fault time read from each record's COMTRADE file.
  Records without a county stay per region under "Not recorded". A fault time from a recorder with no time zone is labelled
  "read as UTC" in the Library. `make a-seed-outages` loads a realistic week of records.
- **Guards:** every endpoint except the webhook verifies the JWT signature here (insights spends money, so it cannot lean on
  filegrid-api). The Storage Lab routes did not: a forged `role: admin` payload could start a benchmark; fixed. `AI_MAX_CALLS_PER_HOUR`
  (default 120) caps model calls across all three features. It is a loop guard, not billing: **set the spend limit in the Anthropic Console.**
- **Settings:** `NARRATOR_MODEL`, `ANALYST_MODEL` (Haiku while building; `claude-sonnet-5-5` for the demo), `AI_MAX_CALLS_PER_HOUR`, with defaults
  in `services/insights/compose.yml`.

### Requests to other zones
- **Zone B:** add `NARRATOR_MODEL`, `ANALYST_MODEL` and `AI_MAX_CALLS_PER_HOUR` to `.env.example` (compose already defaults them).
- **Zone A:** `meter_intervals` is still empty (anomalies need it). County on outage uploads: done in the zone A county PR.

## Pager (round 6)

Only alerts that put a "never lose data" guarantee at risk wake a person; everything else stays on the feed.
Rules are in `contracts/alerts.md` ("Paging"), code in `services/insights/src/intelligence/pager.ts`.

- **platform → admin on-call:** `StorageDown`, `IntegrityFailure`, `MeterReadingLossRisk`, `DocumentProtectionFailure`
  after they have fired for `PAGER_HOLD_SEC` (60 s). The push carries the alert summary and the Haiku narration.
- **grid → that region's dispatch on-call:** ≥ `PAGER_GRID_THRESHOLD` (5) outage records from one county in 15 min,
  read from `public.files` (view `insights.v_outage_bursts`). Closes after 15 quiet minutes, then can page again.
- **Delivery:** ntfy. Topics `<NTFY_TOPIC>-admin`, `<NTFY_TOPIC>-dispatch-{muntenia,banat,dobrogea}`. The
  Acknowledge button posts a one-time token to `<NTFY_TOPIC>-ack`; insights listens there, so the phone never
  has to reach the laptop. Without `NTFY_TOPIC` pages still show on Operations ("In app only").
- **UI:** Operations → Pager panel (admin: both routes, dispatch: grid only; enforced by insights, not just the UI).

### Demo setup (2 minutes)
1. Phone: install the ntfy app, subscribe to `<topic>-admin` and `<topic>-dispatch-dobrogea` on ntfy.sh.
2. `.env`: `NTFY_TOPIC=filegrid-<long random>` (e.g. `openssl rand -hex 8`), optionally `PAGER_HOLD_SEC=20` for a
   faster stage beat and `FILEGRID_PUBLIC_URL=https://<laptop LAN IP>`. Then `make c-insights`.
3. Chaos → stop S3. ~60 s later the admin phone buzzes; tap Acknowledge and Operations shows "acknowledged from the phone".
4. Upload 5 outage records for Constanța within 15 min: the Dobrogea dispatch phone buzzes.
