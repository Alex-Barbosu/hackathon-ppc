-- Zone A. State of resumable (tus) uploads, shared by every API replica so any instance can
-- serve the next chunk. Holds no file bytes: finished parts live in S3 multipart, and a
-- sub-part leftover lives as a small object in the same bucket.

CREATE TABLE tus_uploads (
    id            uuid PRIMARY KEY,          -- also the future files.id and the S3 object key
    category      text        NOT NULL CHECK (category IN ('meter', 'outage', 'document', 'video')),
    region        text CHECK (region IN ('muntenia', 'banat', 'dobrogea')),
    original_name text,
    content_type  text,
    uploaded_by   text,
    bucket        text        NOT NULL,
    object_key    text        NOT NULL,
    s3_upload_id  text        NOT NULL,
    upload_length bigint      NOT NULL CHECK (upload_length > 0),
    part_size     integer     NOT NULL CHECK (part_size >= 5242880),  -- S3 minimum for non-last parts
    upload_offset bigint      NOT NULL DEFAULT 0,   -- bytes the client may count on
    busy_ms       bigint      NOT NULL DEFAULT 0,   -- time spent receiving, for the op duration metric
    trace_id      text,
    completed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tus_uploads_updated_idx ON tus_uploads (updated_at);

CREATE TABLE tus_parts (
    upload_id   uuid    NOT NULL REFERENCES tus_uploads (id) ON DELETE CASCADE,
    part_number integer NOT NULL,
    etag        text    NOT NULL,
    PRIMARY KEY (upload_id, part_number)
);
