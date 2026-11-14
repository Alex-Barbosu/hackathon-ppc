-- Zone A owns V100–V199. Tables from contracts/db.md, created empty by the base.

CREATE TABLE files (
    id               uuid PRIMARY KEY,
    category         text        NOT NULL CHECK (category IN ('meter', 'outage', 'document', 'video')),
    storage          text        NOT NULL CHECK (storage IN ('db', 's3', 'ftp', 'spool')),
    object_key       text        NOT NULL,
    size_bytes       bigint      NOT NULL,
    sha256           char(64)    NOT NULL,
    content_type     text,
    original_name    text,
    description      text,
    region           text CHECK (region IN ('muntenia', 'banat', 'dobrogea')),
    county           text,
    uploaded_by      text,
    encrypted        boolean     NOT NULL DEFAULT false,
    wrapped_key      bytea,
    iv               bytea,
    status           text        NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'spooled', 'corrupt')),
    trace_id         text,
    metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_verified_at timestamptz
);
CREATE INDEX files_category_created_idx ON files (category, created_at DESC);
CREATE INDEX files_region_idx ON files (region);

CREATE TABLE stored_blobs (
    file_id uuid PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
    data    bytea NOT NULL
);

CREATE TABLE meter_readings (
    id              bigserial PRIMARY KEY,
    meter_id        text        NOT NULL,
    region          text,
    county          text,
    lat             double precision,
    lon             double precision,
    period_start    timestamptz NOT NULL,
    seq             integer     NOT NULL,
    idempotency_key text        NOT NULL UNIQUE,
    raw             jsonb       NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    trace_id        text,
    -- The billing guarantee: a reading can be stored exactly once.
    CONSTRAINT meter_readings_once UNIQUE (meter_id, period_start, seq)
);

CREATE TABLE meter_intervals (
    meter_id text          NOT NULL,
    ts       timestamptz   NOT NULL,
    kwh      numeric(10, 4) NOT NULL,
    voltage  numeric(6, 2),
    flags    text[]        NOT NULL DEFAULT '{}',
    PRIMARY KEY (meter_id, ts)
);

CREATE TABLE audit_log (
    id        bigserial PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    actor     text        NOT NULL,
    action    text        NOT NULL,
    file_id   uuid,
    details   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    prev_hash char(64)    NOT NULL,
    hash      char(64)    NOT NULL UNIQUE
);

CREATE TABLE policy_versions (
    version    integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by text        NOT NULL,
    policy     jsonb       NOT NULL
);

CREATE TABLE spool_items (
    id              bigserial PRIMARY KEY,
    file_id         uuid        NOT NULL,
    category        text        NOT NULL,
    target_storage  text        NOT NULL,
    spool_path      text        NOT NULL,
    attempts        integer     NOT NULL DEFAULT 0,
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);
