-- One-off backfill: fill meter_intervals from the raw readings already stored.
--
-- New readings write their intervals themselves (MeterRepository, same transaction). This covers the readings
-- stored before that. It is safe to run on a table that already has rows: ON CONFLICT DO NOTHING on (meter_id, ts),
-- so nothing is duplicated and no existing row is changed.
--
-- Rules, the same as in the application code:
--   * an interval needs a timestamp and a numeric kwh that fits numeric(10,4); otherwise it is skipped (it stays in raw);
--   * a voltage that is not a number, or does not fit numeric(6,2), becomes null;
--   * flags is the JSON array of strings, or empty.
-- Every cast sits behind a CASE on the JSON type, so an odd value skips an interval and never stops the migration.
INSERT INTO meter_intervals (meter_id, ts, kwh, voltage, flags)
SELECT r.meter_id,
       x.ts,
       x.kwh,
       x.voltage,
       x.flags
FROM meter_readings r
CROSS JOIN LATERAL (
    SELECT (i ->> 'ts')::timestamptz                                   AS ts,
           round((i ->> 'kwh')::numeric, 4)::numeric(10, 4)            AS kwh,
           CASE
               WHEN jsonb_typeof(i -> 'voltage') = 'number' AND abs((i ->> 'voltage')::numeric) < 9999.995
                   THEN round((i ->> 'voltage')::numeric, 2)::numeric(6, 2)
           END                                                         AS voltage,
           CASE
               WHEN jsonb_typeof(i -> 'flags') = 'array'
                   THEN ARRAY(SELECT jsonb_array_elements_text(i -> 'flags'))
               ELSE '{}'::text[]
           END                                                         AS flags
    FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(r.raw -> 'intervals') = 'array' THEN r.raw -> 'intervals' ELSE '[]'::jsonb END
         ) AS i
    WHERE CASE WHEN jsonb_typeof(i -> 'ts') = 'string' THEN true ELSE false END
      AND CASE
              WHEN jsonb_typeof(i -> 'kwh') = 'number' THEN abs((i ->> 'kwh')::numeric) < 999999.99995
              ELSE false
          END
) x
ON CONFLICT (meter_id, ts) DO NOTHING;
