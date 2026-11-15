-- Zone C: the pager (contracts/alerts.md "Paging"). A page is a critical alert that woke someone up,
-- so it is its own row: who was paged, whether the push left, who acknowledged it and how.

CREATE TABLE IF NOT EXISTS insights.pages (
    id             bigserial PRIMARY KEY,
    route          text NOT NULL CHECK (route IN ('platform', 'grid')),
    -- One open page per thing at risk: "alert:<id>" or "grid:<county>". Cleared on resolve so a
    -- second storm in the same county pages again.
    open_key       text,
    on_call        text NOT NULL,
    topic          text,
    title          text NOT NULL,
    message        text NOT NULL,
    link           text,
    alert_id       bigint REFERENCES insights.alerts (id),
    alertname      text,
    region         text,
    county         text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    resolved_at    timestamptz,
    delivery       text NOT NULL DEFAULT 'pending' CHECK (delivery IN ('sent', 'pending', 'failed', 'off')),
    attempts       int NOT NULL DEFAULT 0,
    -- One-time secret the phone's Acknowledge button posts back through ntfy; never returned by the API.
    ack_token      text NOT NULL,
    acked_at       timestamptz,
    acked_by       text
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_open_key ON insights.pages (open_key) WHERE open_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pages_recent ON insights.pages (created_at DESC);

-- Outage records per county uploaded in the last 15 minutes: the grid route's signal. Upload time, not
-- the COMTRADE fault time, because the page is about what dispatch is receiving right now.
CREATE OR REPLACE VIEW insights.v_outage_bursts AS
SELECT f.county,
       coalesce(c.region, f.region)  AS region,
       count(*)::int                 AS outages,
       max(f.created_at)             AS last_at,
       (array_agg(f.metadata ->> 'station' ORDER BY f.created_at DESC)
            FILTER (WHERE f.metadata ? 'station'))[1] AS last_station
FROM public.files f
LEFT JOIN insights.county_centroids c ON c.county = f.county
WHERE f.category = 'outage'
  AND f.county IS NOT NULL
  AND f.created_at > now() - interval '15 minutes'
  AND coalesce(f.description, '') NOT LIKE 'storage-lab%'
GROUP BY f.county, coalesce(c.region, f.region);
