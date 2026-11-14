-- Storage Lab runs. Cells and recommendation are jsonb: the shape grows with the benchmark
-- and nothing else queries into them.
CREATE TABLE IF NOT EXISTS insights.storage_lab_runs (
    id               uuid PRIMARY KEY,
    status           text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    samples_per_cell integer NOT NULL,
    cells            jsonb NOT NULL DEFAULT '[]'::jsonb,
    recommendation   jsonb NOT NULL DEFAULT '[]'::jsonb,
    error            text
);
CREATE INDEX IF NOT EXISTS storage_lab_runs_started_idx ON insights.storage_lab_runs (started_at DESC);
