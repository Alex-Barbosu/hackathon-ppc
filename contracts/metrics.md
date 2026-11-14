# Metrics contract (v0)

Prometheus names. Zone B builds dashboards and alerts against these names before zone A
emits them, so **never rename without a contract PR**. Units are in the name (`_seconds`,
`_bytes`). Label values are the enums from `openapi.yaml`.

## Emitted by filegrid-api (zone A)

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `filegrid_op_duration_seconds` | histogram | `category`, `storage`, `op` (`write`\|`read`\|`verify`), `outcome` (`ok`\|`error`\|`fallback`) | Time from request accepted to storage confirmed. Buckets: 0.005 … 60 s, plus 120, 300, 600 for video. p50/p95/p99 come from here. |
| `filegrid_ops_total` | counter | `category`, `storage`, `op`, `outcome` | Throughput and error rate. |
| `filegrid_bytes_total` | counter | `category`, `storage`, `direction` (`in`\|`out`) | Bytes moved. |
| `filegrid_queue_depth` | gauge | `category` | Items waiting in the category's bulkhead queue. |
| `filegrid_meter_readings_total` | counter | `result` (`accepted`\|`duplicate`\|`rejected`) | Exactly-once proof: accepted must equal unique readings sent. |
| `filegrid_integrity_failures_total` | counter | `category`, `storage` | SHA-256 mismatch on read or verify. |
| `filegrid_spool_pending` | gauge | `category` | Items parked in the fallback spool. |
| `filegrid_storage_up` | gauge (0/1) | `storage` | Last health probe result. |
| `filegrid_circuit_open` | gauge (0/1) | `storage` | Circuit breaker state. |
| `filegrid_upload_resumes_total` | counter | `category` | tus uploads that resumed after an interruption. |

Spring Boot exposes them at `GET /actuator/prometheus` (port 8080, internal only).
Note: Micrometer appends `_seconds` / `_total` itself — register `filegrid.op.duration`
as a Timer and `filegrid.ops` as a Counter to get the names above.

## Emitted by meter-simulator (zone B)

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `meter_sim_sent_total` | counter | `region` | Unique readings generated (retries not counted). |
| `meter_sim_acked_total` | counter | `region`, `result` (`accepted`\|`duplicate`) | Acks received. |
| `meter_sim_retries_total` | counter | `region` | Retries (same Idempotency-Key). |
| `meter_sim_rate` | gauge | — | Configured readings per second. |

Exposed at `GET /metrics` on port 9100.

## Emitted by insights and chaos-control
Free to add, prefix `insights_` / `chaos_`. Document them here when a dashboard uses them.

## Traces and logs
- Every inbound request carries or starts a W3C `traceparent`; spans export over OTLP to
  `otel-collector:4317` (gRPC) or `:4318` (HTTP).
- Span names: `http <method> <route>`, `policy.route`, `storage.write`, `storage.read`, `integrity.verify`.
- Span attributes: `filegrid.category`, `filegrid.storage`, `filegrid.file_id`, `filegrid.size_bytes`.
- Logs are JSON with `trace_id`, `span_id`, `category`, `storage`, `file_id`; ship over OTLP
  logs to the collector (it forwards to Loki). **Never log document file names or contents.**
