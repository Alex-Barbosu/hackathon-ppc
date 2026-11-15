-- Zone C: the pager also watches storage health directly (seconds, not the alert's 30 s + hold), so a page
-- remembers which storage it is about. That lets the slower StorageDown alert see the incident is already paged.
ALTER TABLE insights.pages ADD COLUMN IF NOT EXISTS storage text;
CREATE INDEX IF NOT EXISTS pages_open_storage ON insights.pages (storage) WHERE resolved_at IS NULL;
