package ro.ppc.filegrid.tus;

import io.micrometer.tracing.Tracer;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Region;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.FileRow;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.resilience.Bulkheads;
import ro.ppc.filegrid.storage.S3Storage;

/**
 * Resumable uploads (tus 1.0) written straight to S3 multipart.
 *
 * <p><b>Memory.</b> A request holds at most one part buffer (the policy's {@code chunkMb},
 * 16 MB by default), whatever the file size, so a 1 GB upload keeps the heap flat.
 *
 * <p><b>Resuming.</b> The client may only count on {@code offset} bytes. Every byte below it
 * is durable: either in a finished S3 part, or in a small leftover object for the bytes that
 * have not yet filled a part. State lives in Postgres, so any replica can take the next chunk.
 * A request that dies midway keeps what it already received.
 *
 * <p><b>Integrity.</b> SHA-256 is computed while the bytes stream in. If the chunks of one
 * upload were not all handled by the same instance, the running digest is unavailable and the
 * finished object is read back once to hash it.
 */
@Service
public class TusService {

    private static final Logger log = LoggerFactory.getLogger(TusService.class);

    static final int DEFAULT_PART_MB = 16;
    static final Duration IDLE_LIMIT = Duration.ofHours(24);

    private final PolicyService policy;
    private final TusStore store;
    private final TusObjectStore objects;
    private final FileGridMetrics metrics;
    private final Tracer tracer;
    private final DigestCache digests = new DigestCache();
    private final Bulkheads bulkheads;

    public TusService(PolicyService policy, TusStore store, TusObjectStore objects,
                      FileGridMetrics metrics, Tracer tracer, Bulkheads bulkheads) {
        this.policy = policy;
        this.store = store;
        this.objects = objects;
        this.metrics = metrics;
        this.tracer = tracer;
        this.bulkheads = bulkheads;
    }

    /** Result of one PATCH: the new offset, and the file id once the upload has finished. */
    public record PatchResult(long offset, UUID fileId) {
    }

    // ---------------------------------------------------------------- create

    public UUID create(long length, Map<String, String> metadata, String username) {
        Category category = parseCategory(metadata.get("category"));
        CategoryPolicy cp = policy.policyFor(category);
        if (cp.primaryStorage() != Storage.S3) {
            // Multipart streaming is an S3 feature; db and ftp categories use POST /files.
            throw ApiException.badRequest("category " + category.slug()
                    + " is not stored in s3, use POST /api/v1/files");
        }
        if (cp.encrypt() || cp.auditEnabled()) {
            // This path does not encrypt or audit yet. Accepting the upload would quietly break
            // the policy, so refuse it and let the client use POST /files.
            throw ApiException.badRequest("category " + category.slug()
                    + " requires encryption or auditing, which resumable upload does not support yet,"
                    + " use POST /api/v1/files");
        }
        if (length <= 0) {
            throw ApiException.badRequest("Upload-Length must be greater than 0");
        }
        if (length > cp.maxSizeBytes()) {
            throw ApiException.tooLarge(category.slug() + " exceeds maxSizeMb=" + cp.maxSizeMb());
        }
        String region = blankToNull(metadata.get("region"));
        if (region != null) {
            try {
                region = Region.fromSlug(region).slug();
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("unknown region");
            }
        }
        int partSize = (cp.chunkMb() == null ? DEFAULT_PART_MB : cp.chunkMb()) * 1024 * 1024;
        UUID id = UUID.randomUUID();
        String bucket = S3Storage.bucketFor(category);
        String key = id.toString();
        String contentType = blankToNull(metadata.get("filetype")) == null
                ? "application/octet-stream" : metadata.get("filetype");

        String s3Id = s3Call(() -> objects.begin(bucket, key, contentType));
        try {
            store.insert(new TusUpload(id, category, region, blankToNull(metadata.get("filename")),
                    contentType, username, bucket, key, s3Id, length, partSize, 0, 0, traceId(),
                    null, null, null));
        } catch (RuntimeException e) {
            quietly(() -> objects.abort(bucket, key, s3Id));
            throw e;
        }
        // file_id only: the file name can be a person's name.
        log.info("tus upload created file_id={} category={} size={}", id, category.slug(), length);
        return id;
    }

    // ------------------------------------------------------------------ head

    public TusUpload head(UUID id) {
        TusUpload up = store.find(id).orElseThrow(() -> ApiException.notFound("no such upload"));
        if (!up.completed() && up.offset() > 0) {
            // tus clients only ask for the offset when they are resuming.
            metrics.recordUploadResume(up.category());
        }
        return up;
    }

    // ----------------------------------------------------------------- patch

    public PatchResult append(UUID id, long clientOffset, long contentLength, InputStream body) {
        long started = System.nanoTime();
        TusUpload up = store.find(id).orElseThrow(() -> ApiException.notFound("no such upload"));

        if (up.completed()) {
            if (clientOffset == up.length() && contentLength <= 0) {
                return new PatchResult(up.length(), up.id()); // the client missed the last answer
            }
            throw ApiException.conflict("upload is already complete");
        }
        if (clientOffset != up.offset()) {
            throw ApiException.conflict("Upload-Offset does not match, the server is at " + up.offset());
        }
        long remaining = up.length() - up.offset();
        if (contentLength > remaining) {
            throw ApiException.tooLarge("body is larger than the declared Upload-Length");
        }

        // One chunk is one unit of work. Waiting here costs nothing, but running holds a part buffer, so the
        // category's limit also bounds how much memory its uploads can use at once.
        try (Bulkheads.Permit ignored = bulkheads.enter(up.category())) {
            return receive(up, started, remaining, body);
        }
    }

    /** Receives one chunk. Runs inside the category's bulkhead. */
    private PatchResult receive(TusUpload up, long started, long remaining, InputStream body) {
        UUID id = up.id();
        int partSize = up.partSize();
        byte[] buf = new byte[partSize];
        int n = 0;
        long dbOffset = up.offset();
        long partBytes = up.partBytes();

        int tail = up.tailLength();
        if (tail > 0) {
            byte[] saved = s3Call(() -> objects.getTail(up.bucket(), up.objectKey())).orElse(null);
            if (saved == null || saved.length != tail) {
                // The leftover is gone. Fall back to the last whole part so the client resends the rest.
                store.advance(id, dbOffset, partBytes, 0);
                digests.drop(id);
                throw ApiException.conflict("leftover bytes missing, resume from " + partBytes);
            }
            System.arraycopy(saved, 0, buf, 0, tail);
            n = tail;
        }

        // The running hash is only valid if it has seen exactly the bytes below the offset.
        MessageDigest digest = digests.take(id, up.offset());
        if (digest == null && up.offset() == 0) {
            digest = Hashing.sha256();
        }

        long consumed = 0;
        long busyMs = 0;
        long mark = started;
        boolean interrupted = false;
        try {
            while (consumed < remaining) {
                int r = body.read(buf, n, (int) Math.min(buf.length - n, remaining - consumed));
                if (r < 0) {
                    break;
                }
                if (r == 0) {
                    continue;
                }
                if (digest != null) {
                    digest.update(buf, n, r);
                }
                n += r;
                consumed += r;

                boolean last = up.offset() + consumed == up.length();
                if (n == buf.length || last) {
                    int partNumber = (int) (partBytes / partSize) + 1;
                    String etag = putPart(up, partNumber, buf, n);
                    store.putPart(id, partNumber, etag);
                    partBytes += n;
                    n = 0;
                    if (!last) {
                        long now = System.nanoTime();
                        long delta = (now - mark) / 1_000_000;
                        if (!store.advance(id, dbOffset, partBytes, delta)) {
                            throw ApiException.conflict("another request is writing this upload");
                        }
                        busyMs += delta;
                        mark = now;
                        dbOffset = partBytes;
                    }
                }
            }
        } catch (IOException e) {
            // The client went away mid-chunk. Keep what arrived so the resume starts close to here.
            interrupted = true;
            log.info("tus upload interrupted file_id={} received={}", id, consumed);
        } catch (RuntimeException e) {
            digests.drop(id); // bytes in the buffer were never stored, so the digest is ahead of the offset
            throw e;
        }

        long pos = up.offset() + consumed;
        long delta = (System.nanoTime() - mark) / 1_000_000;
        if (!interrupted && pos == up.length()) {
            return finish(up, digest, busyMs + delta, consumed);
        }

        // Not finished: make the bytes left in the buffer durable too.
        long newOffset = partBytes + n;
        try {
            if (n > 0) {
                int len = n;
                s3Run(() -> objects.putTail(up.bucket(), up.objectKey(), buf, len));
            }
            if (newOffset != dbOffset && !store.advance(id, dbOffset, newOffset, delta)) {
                throw ApiException.conflict("another request is writing this upload");
            }
        } catch (RuntimeException e) {
            digests.drop(id);
            throw e;
        }
        if (digest != null) {
            digests.put(id, digest, newOffset);
        }
        metrics.recordBytes(up.category(), Storage.S3, "in", consumed);
        return new PatchResult(newOffset, null);
    }

    private PatchResult finish(TusUpload up, MessageDigest digest, long busyDelta, long consumed) {
        UUID id = up.id();
        List<TusStore.PartRef> parts = store.parts(id);
        s3Run(() -> objects.complete(up.bucket(), up.objectKey(), up.s3UploadId(), parts));

        long stored = s3Call(() -> objects.size(up.bucket(), up.objectKey()));
        if (stored != up.length()) {
            throw ApiException.storageUnavailable("stored size differs from the declared length");
        }

        String sha;
        if (digest != null) {
            sha = Hashing.hex(digest.digest());
        } else {
            log.warn("tus digest unavailable, hashing the stored object file_id={}", id);
            sha = hashStored(up);
        }
        quietly(() -> objects.deleteTail(up.bucket(), up.objectKey()));

        FileRow row = new FileRow(id, up.category().slug(), Storage.S3.slug(),
                up.bucket() + "/" + up.objectKey(), up.length(), sha, up.contentType(),
                up.originalName(), null, up.region(), null, up.uploadedBy(), false, "stored",
                up.traceId(), null, null);
        store.complete(id, row, busyDelta);
        digests.drop(id);

        metrics.recordOp(up.category(), Storage.S3, FileGridMetrics.Op.WRITE, FileGridMetrics.Outcome.OK,
                Duration.ofMillis(up.busyMs() + busyDelta));
        metrics.recordBytes(up.category(), Storage.S3, "in", consumed);
        log.info("stored file_id={} category={} storage=s3 size={} via=tus",
                id, up.category().slug(), up.length());
        return new PatchResult(up.length(), id);
    }

    private String hashStored(TusUpload up) {
        try (InputStream in = s3Call(() -> objects.open(up.bucket(), up.objectKey()))) {
            DigestInputStream d = new DigestInputStream(in, Hashing.sha256());
            byte[] chunk = new byte[64 * 1024];
            while (d.read(chunk) != -1) {
                // drain: the digest updates as we read, nothing is kept
            }
            return Hashing.hex(d.getMessageDigest().digest());
        } catch (IOException e) {
            throw ApiException.storageUnavailable("cannot read the stored object");
        }
    }

    private String putPart(TusUpload up, int partNumber, byte[] buf, int len) {
        return s3Call(() -> objects.putPart(up.bucket(), up.objectKey(), up.s3UploadId(), partNumber, buf, len));
    }

    // --------------------------------------------------------------- cleanup

    /** Abandoned uploads would keep their parts in S3 forever, so drop what has been idle a day. */
    @Scheduled(initialDelayString = "PT5M", fixedDelayString = "PT1H")
    public void cleanup() {
        for (TusUpload u : store.findIdleSince(Instant.now().minus(IDLE_LIMIT))) {
            try {
                if (!u.completed()) {
                    quietly(() -> objects.abort(u.bucket(), u.objectKey(), u.s3UploadId()));
                    quietly(() -> objects.deleteTail(u.bucket(), u.objectKey()));
                    log.info("tus upload expired file_id={}", u.id());
                }
                store.delete(u.id());
                digests.drop(u.id());
            } catch (RuntimeException e) {
                log.warn("tus cleanup failed file_id={}", u.id());
            }
        }
    }

    // --------------------------------------------------------------- helpers

    private static Category parseCategory(String s) {
        try {
            return Category.fromSlug(s);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Upload-Metadata needs a valid category");
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private String traceId() {
        var span = tracer.currentSpan();
        return span == null ? null : span.context().traceId();
    }

    /** Any storage failure becomes a 503, which tus clients retry on their own. */
    private static <T> T s3Call(Supplier<T> call) {
        try {
            return call.get();
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            log.warn("object storage call failed: {}", e.getClass().getSimpleName());
            throw ApiException.storageUnavailable("object storage unavailable");
        }
    }

    private static void s3Run(Runnable call) {
        s3Call(() -> {
            call.run();
            return null;
        });
    }

    private static void quietly(Runnable call) {
        try {
            call.run();
        } catch (RuntimeException e) {
            log.debug("best-effort cleanup failed: {}", e.getClass().getSimpleName());
        }
    }
}
