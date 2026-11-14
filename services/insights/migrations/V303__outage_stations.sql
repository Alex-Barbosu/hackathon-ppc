-- Outage hotspots by county AND station (contracts/openapi.yaml Hotspot.stations, lastFaultAt).
-- Zone A now stores the county dispatch picks at upload, and the station and fault time it reads from the
-- COMTRADE file (files.metadata). Read-only views over public.files, like V302.

-- V302 placed counties that are not served (Prahova, Dâmbovița, Argeș) and missed three that are. Add the
-- missing ones so every County of the contract can sit on the map; the extra rows are never joined, so they stay.
INSERT INTO insights.county_centroids (county, region, lat, lon) VALUES
    ('Giurgiu', 'muntenia', 43.90, 25.97), ('Călărași', 'dobrogea', 44.20, 27.33),
    ('Ialomița', 'dobrogea', 44.56, 27.37)
ON CONFLICT (county) DO NOTHING;

-- One row per county (or region, when no county was given) and station. The fault time is cast only when it looks
-- like an ISO timestamp, so one odd file can never make the whole view fail.
CREATE OR REPLACE VIEW insights.v_outage_stations AS
SELECT coalesce(f.county, 'Not recorded')            AS county,
       coalesce(c.region, f.region, 'unknown')       AS region,
       f.metadata ->> 'station'                       AS station,
       count(*)::int                                  AS outages,
       max(CASE WHEN f.metadata ->> 'faultTime' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                THEN (f.metadata ->> 'faultTime')::timestamptz END) AS last_fault_at
FROM public.files f
LEFT JOIN insights.county_centroids c ON c.county = f.county
WHERE f.category = 'outage'
  AND coalesce(f.description, '') NOT LIKE 'storage-lab%'
  AND f.metadata ? 'station'
GROUP BY 1, 2, 3;

-- Same columns as V302 first (CREATE OR REPLACE may only add columns at the end), then the latest fault and the
-- top five stations as JSON, so one query answers the hotspot endpoint.
CREATE OR REPLACE VIEW insights.v_outage_by_county AS
WITH counties AS (
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
    GROUP BY 1, 2, 3, 4
)
SELECT k.county, k.region, k.lat, k.lon, k.outages, k.total_minutes,
       s.last_fault_at,
       coalesce(s.stations, '[]'::jsonb) AS stations
FROM counties k
LEFT JOIN LATERAL (
    SELECT max(t.last_fault_at) AS last_fault_at,
           jsonb_agg(jsonb_build_object('station', t.station, 'outages', t.outages, 'last_fault_at', t.last_fault_at)
                     ORDER BY t.outages DESC, t.last_fault_at DESC NULLS LAST) FILTER (WHERE t.rank <= 5) AS stations
    FROM (SELECT st.*, row_number() OVER (ORDER BY st.outages DESC, st.last_fault_at DESC NULLS LAST) AS rank
          FROM insights.v_outage_stations st
          WHERE st.county = k.county AND st.region = k.region) t
) s ON true;
