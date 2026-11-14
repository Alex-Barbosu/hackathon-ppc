-- Zone A. A file stored in the database is written as one transaction holding the blob and the
-- files row. The blob goes in first (its SHA-256 and size are only known once it has streamed
-- in), so the foreign key to files must be checked at commit, not at the insert. The guarantee
-- is unchanged: a blob with no files row cannot be committed.

ALTER TABLE stored_blobs DROP CONSTRAINT stored_blobs_file_id_fkey;
ALTER TABLE stored_blobs
    ADD CONSTRAINT stored_blobs_file_id_fkey
        FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED;
