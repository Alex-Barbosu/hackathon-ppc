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
