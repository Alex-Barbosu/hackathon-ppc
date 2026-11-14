# Zone C — Experience and intelligence

Zone notes, decisions and demo evidence go here. The agent rules are in this zone's `CLAUDE.md`.

## Web: Upload and Library (P0 item 1)

- API base: `VITE_API_BASE` (default `/mock`, the Prism mock). Set `VITE_API_BASE=` (empty) to hit the real gateway.
  Requests use `openapi-fetch` typed from `src/api/schema.d.ts`; the bearer token comes from `state/session.ts`
  (placeholder until the Login screen lands).
- Upload: outage/document use multipart `POST /api/v1/files`; video uses Uppy + `@uppy/tus` with 16 MB chunks and
  automatic retry. "Resumed after disconnect" is driven by tus-js-client's `onShouldRetry` (Uppy emits no event for it).
- Library: `GET /api/v1/files` filters; download shows "Verified" or, on `422`, an integrity-failed state.
- Known limit: Library download buffers the file as a Blob so the bearer header can be sent. Fine for outage and
  documents; a 1 GB video download needs a signed-URL or cookie-auth contract change (request for zone A).

## Insights: knowledge corpus (for the analyst's `search_knowledge` tool)

- `services/insights/corpus/`: 16 expert-sourced chunks for brief section 5 (reliability indices and
  Romanian SAIDI yardsticks, Major Event Days, smart meter anomalies, load shape, SRE alerting,
  latency measurement, storage fit). Sources and licence notes in `corpus/SOURCES.md`.
- `src/knowledge.ts`: `loadCorpus()` + `searchKnowledge(chunks, query, {answers})`, a keyword scorer.
  Wire it as the analyst tool `search_knowledge(query)`; return chunk ids so answers can show source chips.
- YouTube transcripts: run `corpus/tools/fetch_transcripts.py` locally; output is gitignored (third-party content).
