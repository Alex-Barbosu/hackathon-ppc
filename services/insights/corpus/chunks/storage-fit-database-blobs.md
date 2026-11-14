---
id: storage-fit-database-blobs
source: [pg-wiki-binary]
title: When files belong in PostgreSQL and when they do not
topics: [storage, postgresql, bytea, large-objects, storage-fit]
answers: [storage-fit]
---
From the PostgreSQL wiki page "BinaryFilesInDB". Facts paraphrased.

**Options**
- **bytea** (stored via TOAST): plain SQL, same access control and transactions as other data.
  Limit 1 GB per value. The whole value passes through server memory, so memory use is high.
- **Large objects**: streaming and seeking, up to 4 TB each, but a separate API and OIDs to
  track in a metadata table.
- **Filesystem or object store with metadata in the DB**: fastest access, database stays small;
  but two systems can drift out of sync and security is split.

**Trade-offs**
- In-database files are backed up and replicated with the data automatically, and are
  **ACID with their metadata** (the file and its record commit together or not at all).
- Backups get much slower and storage costs more as files grow.
- The wiki's guidance: keep files in the database when they must be transactional with the
  record (its example: inspection photos that are part of a record); avoid it for very large
  files (100 MB+) where performance matters.

**How the analyst uses this (storage fit per category)**
- **Meter readings (1–50 KB, very many, never lost or duplicated)**: database fits. The
  reading, its idempotency key and the unique constraint commit in one transaction, which is
  exactly the "never duplicated" guarantee.
- **Video (100 MB–1 GB+)**: database does not fit (1 GB bytea ceiling, memory per value,
  backup bloat). Object storage with multipart upload fits.
- **Outage (1–10 MB, spiky)** and **documents (0.1–10 MB)**: either works technically; decide
  from Storage Lab's p95 under storm load and from availability needs, and say which numbers
  decided it.
