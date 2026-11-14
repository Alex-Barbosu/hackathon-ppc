-- Finding an identical file (same category and content hash) when an upload arrives: see FileService, content dedup.
-- Not unique: encrypted documents, forced-storage uploads and tus uploads are never merged, and the same bytes may be
-- stored for different regions.
CREATE INDEX IF NOT EXISTS files_category_sha256_idx ON files (category, sha256);
