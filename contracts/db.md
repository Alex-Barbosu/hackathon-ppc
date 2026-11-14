# Database contract (v0)

PostgreSQL 17, database `filegrid`. Two roles:

| Role | Used by | Rights |
| --- | --- | --- |
| `filegrid` | filegrid-api (zone A) | Owns schema `public`. Runs Flyway migrations **V100–V199** from `services/filegrid-api/src/main/resources/db/migration`. |
| `insights` | insights (zone C) | `SELECT` on every table in `public` (default privileges). Owns schema `insights`, where it creates its own views and tables with migrations **V300–V399** from `services/insights/migrations`, tracked in `insights.schema_migrations`. |

Zone C must only read `public` through views in schema `insights`, so a column rename in
zone A breaks one view, not the app. Zone A must not rename or drop a column listed here
without a contract PR.

## Tables in `public` (created empty by `V100__init.sql`)

### `files`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `category` | text | `meter\|outage\|document\|video` |
| `storage` | text | `db\|s3\|ftp\|spool` — where bytes live now |
| `object_key` | text | key/path inside the storage |
| `size_bytes` | bigint | |
| `sha256` | char(64) | of the **original** bytes (before encryption) |
| `content_type` | text | |
| `original_name` | text | never logged for documents |
| `description` | text | |
| `region` | text | `muntenia\|banat\|dobrogea`, nullable |
| `county` | text | nullable |
| `uploaded_by` | text | username |
| `encrypted` | boolean | |
| `wrapped_key` | bytea | per-file data key, wrapped by the master key |
| `iv` | bytea | |
| `status` | text | `stored\|spooled\|corrupt` |
| `trace_id` | text | |
| `metadata` | jsonb | category-specific (e.g. COMTRADE station, fault time) |
| `created_at` | timestamptz | |
| `last_verified_at` | timestamptz | |

### `stored_blobs` — bytes for files whose storage is `db`
`file_id uuid PK → files.id`, `data bytea`.

### `meter_readings` — one row per reading file
`id bigserial PK`, `meter_id text`, `region text`, `county text`, `lat double`, `lon double`,
`period_start timestamptz`, `seq int`, `idempotency_key text UNIQUE`, `raw jsonb`,
`received_at timestamptz`, `trace_id text`. Unique `(meter_id, period_start, seq)`.

### `meter_intervals` — parsed 15-minute values
`meter_id text`, `ts timestamptz`, `kwh numeric(10,4)`, `voltage numeric(6,2)`, `flags text[]`,
PK `(meter_id, ts)`.

### `audit_log` — hash-chained, append only
`id bigserial PK`, `at timestamptz`, `actor text`, `action text`, `file_id uuid`, `details jsonb`,
`prev_hash char(64)`, `hash char(64)` where `hash = sha256(prev_hash || canonical_json(row))`.

### `policy_versions`
`version int PK`, `applied_at timestamptz`, `applied_by text`, `policy jsonb`.

### `spool_items`
`id bigserial PK`, `file_id uuid`, `category text`, `target_storage text`, `spool_path text`,
`attempts int`, `last_error text`, `created_at timestamptz`, `next_attempt_at timestamptz`.

## Views in `insights` (zone C, planned)
`v_files_daily`, `v_meter_daily`, `v_meter_anomaly_candidates`, `v_outage_by_county`,
`v_storage_lab_results`. Add each here when created.
