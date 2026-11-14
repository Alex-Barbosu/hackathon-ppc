-- Zone C: narrated alerts, the briefing cache, and the read-only views behind the anomaly and
-- hotspot endpoints. Views read zone A's tables in `public` (contracts/db.md); a column rename
-- there breaks a view here, not the app.

CREATE TABLE IF NOT EXISTS insights.alerts (
    id               bigserial PRIMARY KEY,
    fingerprint      text NOT NULL,
    alertname        text NOT NULL,
    status           text NOT NULL CHECK (status IN ('firing', 'resolved')),
    severity         text,
    labels           jsonb NOT NULL DEFAULT '{}'::jsonb,
    annotations      jsonb NOT NULL DEFAULT '{}'::jsonb,
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz,
    received_at      timestamptz NOT NULL DEFAULT now(),
    narration        text,
    narration_model  text,
    narrated_at      timestamptz,
    narration_error  text
);
-- Alertmanager repeats a firing alert every few minutes: one row per (fingerprint, start).
CREATE UNIQUE INDEX IF NOT EXISTS alerts_fingerprint_start ON insights.alerts (fingerprint, starts_at);
CREATE INDEX IF NOT EXISTS alerts_recent ON insights.alerts (starts_at DESC);

CREATE TABLE IF NOT EXISTS insights.briefings (
    key          text PRIMARY KEY,
    period_from  timestamptz NOT NULL,
    period_to    timestamptz NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),
    model        text,
    ai           boolean NOT NULL,
    body         jsonb NOT NULL
);

-- Approximate county centres for the three regions, so a hotspot can be placed on a map.
CREATE TABLE IF NOT EXISTS insights.county_centroids (
    county text PRIMARY KEY,
    region text NOT NULL,
    lat    double precision NOT NULL,
    lon    double precision NOT NULL
);
INSERT INTO insights.county_centroids (county, region, lat, lon) VALUES
    ('București', 'muntenia', 44.43, 26.10), ('Ilfov', 'muntenia', 44.55, 26.10),
    ('Prahova', 'muntenia', 45.10, 26.00), ('Dâmbovița', 'muntenia', 44.93, 25.46),
    ('Argeș', 'muntenia', 45.00, 24.87), ('Constanța', 'dobrogea', 44.18, 28.65),
    ('Tulcea', 'dobrogea', 45.18, 28.80), ('Timiș', 'banat', 45.75, 21.23),
    ('Arad', 'banat', 46.18, 21.31), ('Hunedoara', 'banat', 45.75, 22.90),
    ('Caraș-Severin', 'banat', 45.30, 21.89)
ON CONFLICT (county) DO NOTHING;

-- Outage records per county. Benchmark files from the Storage Lab are not outages. Zone A does not
-- record a county for outage uploads yet, so those are counted under "Not recorded" by region.
CREATE OR REPLACE VIEW insights.v_outage_by_county AS
SELECT coalesce(f.county, 'Not recorded')            AS county,
       coalesce(c.region, f.region, 'unknown')       AS region,
       c.lat, c.lon,
       count(*)::int                                  AS outages,
       coalesce(sum(CASE WHEN f.metadata->>'durationMinutes' ~ '^[0-9]+(\.[0-9]+)?$'
                         THEN (f.metadata->>'durationMinutes')::numeric END), 0) AS total_minutes
FROM public.files f
LEFT JOIN insights.county_centroids c ON c.county = f.county
WHERE f.category = 'outage'
  AND coalesce(f.description, '') NOT LIKE 'storage-lab%'
GROUP BY 1, 2, 3, 4;

-- Meter anomaly candidates: each 15-minute value against the same slot on the meter's OTHER days
-- (leave-one-out mean and deviation from sums, so a value never judges itself).
-- consumption_drop / spike: |z| >= 3. stuck_meter: eight identical non-zero readings in a row.
-- voltage_sag: below 207 V (230 V minus 10%).
CREATE OR REPLACE VIEW insights.v_meter_anomaly_candidates AS
WITH recent AS (
    SELECT meter_id, ts, kwh, voltage,
           (extract(hour FROM ts AT TIME ZONE 'UTC') * 4
             + floor(extract(minute FROM ts AT TIME ZONE 'UTC') / 15))::int AS slot
    FROM public.meter_intervals
    WHERE ts > now() - interval '14 days'
), slots AS (
    SELECT meter_id, slot, count(*) AS n, sum(kwh) AS s1, sum(kwh * kwh) AS s2
    FROM recent GROUP BY meter_id, slot
), scored AS (
    SELECT r.meter_id, r.ts, r.kwh, r.voltage,
           CASE WHEN s.n >= 5 THEN (s.s1 - r.kwh) / (s.n - 1) END AS mu,
           CASE WHEN s.n >= 5 THEN
               ((s.s2 - r.kwh * r.kwh) - (s.n - 1) * power((s.s1 - r.kwh) / (s.n - 1), 2)) / (s.n - 2)
           END AS var,
           max(r.kwh) OVER w - min(r.kwh) OVER w AS spread,
           count(*) OVER w AS run
    FROM recent r JOIN slots s ON s.meter_id = r.meter_id AND s.slot = r.slot
    WINDOW w AS (PARTITION BY r.meter_id ORDER BY r.ts ROWS BETWEEN 7 PRECEDING AND CURRENT ROW)
), z AS (
    SELECT *, CASE WHEN var > 0 THEN (kwh - mu) / sqrt(var) END AS z FROM scored
), loc AS (
    SELECT DISTINCT ON (meter_id) meter_id, region, county
    FROM public.meter_readings ORDER BY meter_id, received_at DESC
)
SELECT z.meter_id, loc.region, loc.county, k.kind, round(k.score, 2) AS score,
       z.ts AS at, z.kwh, round(z.mu, 4) AS baseline_kwh, z.voltage
FROM z
LEFT JOIN loc ON loc.meter_id = z.meter_id
CROSS JOIN LATERAL (VALUES
    ('consumption_drop', CASE WHEN z.z <= -3 THEN -z.z END),
    ('spike',            CASE WHEN z.z >= 3 THEN z.z END),
    ('stuck_meter',      CASE WHEN z.run = 8 AND z.spread = 0 AND z.kwh > 0 THEN 8::numeric END),
    ('voltage_sag',      CASE WHEN z.voltage < 207 THEN (230 - z.voltage) / 5 END)
) AS k(kind, score)
WHERE k.score IS NOT NULL;
