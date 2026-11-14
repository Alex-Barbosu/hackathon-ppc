-- Zone C owns V300–V399, applied inside schema `insights` by src/migrate.ts.
-- Views read zone A's tables in `public` (contracts/db.md). Read-only by design.

CREATE OR REPLACE VIEW insights.v_files_daily AS
SELECT date_trunc('day', created_at) AS day,
       category,
       storage,
       count(*)        AS files,
       sum(size_bytes) AS bytes
FROM public.files
GROUP BY 1, 2, 3;
