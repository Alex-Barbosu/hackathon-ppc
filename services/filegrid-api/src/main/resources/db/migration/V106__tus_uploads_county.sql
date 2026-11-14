-- A resumable upload may carry a county (contracts/openapi.yaml, tus Upload-Metadata), kept here until the file
-- row is written at completion. Nullable: videos usually have none.
ALTER TABLE tus_uploads ADD COLUMN IF NOT EXISTS county text;
