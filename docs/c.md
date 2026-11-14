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
