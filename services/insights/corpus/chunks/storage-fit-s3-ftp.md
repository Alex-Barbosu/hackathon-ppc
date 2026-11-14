---
id: storage-fit-s3-ftp
source: [aws-s3-multipart, filegrid-synthesis]
title: Object storage vs FTP for large and sensitive files
topics: [storage, s3, ftp, multipart, storage-fit, resumable]
answers: [storage-fit]
---
**S3 multipart upload (AWS documentation).** Objects up to 5 TB; parts of 5 MB to 5 GB (the
last part may be smaller); at most 10,000 parts per upload. Parts upload independently and in
parallel, a failed part is retried alone, and the object appears only when the upload is
completed, so readers never see half a file. SeaweedFS implements the same API. With FileGrid's
16 MB parts, 10,000 parts caps a single video at about 160 GB, far above the brief's 1 GB+.

**FTP/FTPS (team reading).** A plain file protocol with no object metadata, no native checksum
and no multipart; resume exists (REST offset) but is server-dependent. Atomic visibility needs
the "write `.part`, verify, rename" pattern. FTPS adds TLS. It fits where a downstream system
already consumes files from an FTP drop, and for moderate-size documents where a simple,
auditable directory layout is valued.

**How the analyst uses this**
- Video: S3, because multipart gives per-part retry (survives lossy links), parallelism and
  flat memory streaming.
- Documents: FTP is defensible only with encryption at rest done by FileGrid (AES-256-GCM),
  because the storage itself offers no protection if breached; that is the brief's "storage
  breach does not expose personal data".
- When Storage Lab numbers disagree with this reasoning, trust the numbers and say why the
  expectation was wrong.
