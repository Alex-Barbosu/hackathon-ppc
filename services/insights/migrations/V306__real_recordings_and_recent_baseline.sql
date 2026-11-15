-- Two views gave the Insights page wrong or empty answers on a live demo stack. Read-only views, like V302/V303.

-- 1. Hotspots counted load-test traffic. A chaos storm or a k6 run writes hundreds of random-byte "outage" files
--    with no county and no station, and they showed up as the biggest hotspot ("County not recorded").
--    A real recording has a county picked by dispatch, or a station read from the COMTRADE header. Count only those.
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
      AND (f.county IS NOT NULL OR f.metadata ? 'station')
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

-- 2. Meter anomalies were always empty. V302 judges a value against the same quarter hour on five or more other
--    days, and the simulator walks each meter forward one interval per reading, so that history takes days to
--    exist. When it does not, fall back to the meter's own previous readings (up to 12, about three hours), in
--    log space because consumption noise is multiplicative. The bar is higher (3.5 for a drop, 4.5 for a spike) since neighbours also carry
--    the daily ramp. A reading the meter itself flagged power_loss is always a drop.
--    Columns are V302's, plus "basis" at the end so the explanation can say which baseline was used.
CREATE OR REPLACE VIEW insights.v_meter_anomaly_candidates AS
WITH recent AS (
    SELECT meter_id, ts, kwh, voltage, flags,
           (extract(hour FROM ts AT TIME ZONE 'UTC') * 4
             + floor(extract(minute FROM ts AT TIME ZONE 'UTC') / 15))::int AS slot,
           ln(greatest(kwh, 0.001)) AS lk
    FROM public.meter_intervals
    WHERE ts > now() - interval '14 days'
), slots AS (
    SELECT meter_id, slot, count(*) AS n, sum(kwh) AS s1, sum(kwh * kwh) AS s2
    FROM recent GROUP BY meter_id, slot
), scored AS (
    SELECT r.meter_id, r.ts, r.kwh, r.voltage, r.flags, r.lk, s.n,
           CASE WHEN s.n >= 5 THEN (s.s1 - r.kwh) / (s.n - 1) END AS mu,
           CASE WHEN s.n >= 5 THEN
               ((s.s2 - r.kwh * r.kwh) - (s.n - 1) * power((s.s1 - r.kwh) / (s.n - 1), 2)) / (s.n - 2)
           END AS var,
           max(r.kwh) OVER w - min(r.kwh) OVER w AS spread,
           count(*) OVER w AS run,
           avg(r.lk) OVER prev AS lmu, stddev_samp(r.lk) OVER prev AS lsd, count(*) OVER prev AS ln
    FROM recent r JOIN slots s ON s.meter_id = r.meter_id AND s.slot = r.slot
    WINDOW w AS (PARTITION BY r.meter_id ORDER BY r.ts ROWS BETWEEN 7 PRECEDING AND CURRENT ROW),
           prev AS (PARTITION BY r.meter_id ORDER BY r.ts ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING)
), z AS (
    SELECT *,
           CASE WHEN n >= 5 AND var > 0 THEN (kwh - mu) / sqrt(var) END AS z_slot,
           -- The 0.15 floor stops a very steady meter from turning a small wobble into a huge score.
           CASE WHEN n < 5 AND ln >= 8 THEN (lk - lmu) / greatest(lsd, 0.15) END AS z_recent
    FROM scored
), loc AS (
    SELECT DISTINCT ON (meter_id) meter_id, region, county
    FROM public.meter_readings ORDER BY meter_id, received_at DESC
)
SELECT z.meter_id, loc.region, loc.county, k.kind, round(k.score::numeric, 2) AS score,
       z.ts AS at, z.kwh,
       round(coalesce(z.mu, exp(z.lmu))::numeric, 4) AS baseline_kwh, z.voltage,
       CASE WHEN z.n >= 5 THEN 'same_slot' ELSE 'recent' END AS basis
FROM z
LEFT JOIN loc ON loc.meter_id = z.meter_id
CROSS JOIN LATERAL (VALUES
    ('consumption_drop', CASE WHEN z.z_slot <= -3 THEN -z.z_slot
                              WHEN z.z_recent <= -3.5 THEN -z.z_recent
                              WHEN 'power_loss' = ANY (z.flags) AND z.ln >= 1 AND z.lk < z.lmu THEN 3 END),
    ('spike',            CASE WHEN z.z_slot >= 3 THEN z.z_slot WHEN z.z_recent >= 4.5 THEN z.z_recent END),
    ('stuck_meter',      CASE WHEN z.run = 8 AND z.spread = 0 AND z.kwh > 0 THEN 8::numeric END),
    ('voltage_sag',      CASE WHEN z.voltage < 207 THEN (230 - z.voltage) / 5 END)
) AS k(kind, score)
WHERE k.score IS NOT NULL;
