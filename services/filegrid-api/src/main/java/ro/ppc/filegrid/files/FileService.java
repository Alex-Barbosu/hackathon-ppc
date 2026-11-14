package ro.ppc.filegrid.files;

import java.io.InputStream;
import java.security.DigestInputStream;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.common.IntegrityException;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.FileReceipt;
import ro.ppc.filegrid.files.dto.VerifyResult;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * Stores and retrieves files with a SHA-256 integrity proof. The hash is computed while the
 * bytes stream in (DigestInputStream) and recomputed on the way out; a mismatch is a 422
 * INTEGRITY_FAILED (gating requirement 4). Nothing buffers the whole file, so heap stays
 * flat for large uploads (NFR scalability).
 */
@Service
public class FileService {

    private static final Logger log = LoggerFactory.getLogger(FileService.class);

    private final PolicyService policy;
    private final StorageRegistry storages;
    private final FileRepository files;
    private final FileGridMetrics metrics;
    private final ReceiptSigner signer;
    private final io.micrometer.tracing.Tracer tracer;

    public FileService(PolicyService policy, StorageRegistry storages, FileRepository files,
                       FileGridMetrics metrics, ReceiptSigner signer,
                       io.micrometer.tracing.Tracer tracer) {
        this.policy = policy;
        this.storages = storages;
        this.files = files;
        this.metrics = metrics;
        this.signer = signer;
        this.tracer = tracer;
    }

    /** Where a category's bytes go. {@code forceStorage} (admin, Storage Lab) overrides policy. */
    public record UploadRequest(
            Category category, String region, String description, String originalName,
            String contentType, long sizeBytes, String uploadedBy, Storage forceStorage) {
    }

    public FileReceipt store(UploadRequest req, InputStream body) {
        var catPolicy = policy.policyFor(req.category());
        if (req.sizeBytes() > catPolicy.maxSizeBytes()) {
            throw ApiException.tooLarge(req.category().slug() + " exceeds maxSizeMb="
                    + catPolicy.maxSizeMb());
        }

        Storage target = req.forceStorage() != null
                ? req.forceStorage()
                : policy.primaryStorageFor(req.category());
        StorageAdapter adapter = storages.get(target);

        UUID id = UUID.randomUUID();
        String traceId = currentTraceId();

        // Compute the hash as the bytes stream to the backend: one pass, no buffering.
        DigestInputStream hashed = new DigestInputStream(body, Hashing.sha256());
        long started = System.nanoTime();
        StoredRef ref;
        try {
            ref = adapter.write(hashed, id.toString(),
                    WriteMeta.of(req.category(), req.contentType(), req.sizeBytes()));
        } catch (Exception e) {
            metrics.recordOp(req.category(), target, FileGridMetrics.Op.WRITE,
                    FileGridMetrics.Outcome.ERROR, Duration.ofNanos(System.nanoTime() - started));
            throw ApiException.storageUnavailable("write to " + target.slug() + " failed: " + e.getMessage());
        }
        String sha = Hashing.hex(hashed.getMessageDigest().digest());
        Duration took = Duration.ofNanos(System.nanoTime() - started);

        FileRow row = new FileRow(id, req.category().slug(), target.slug(), ref.key(),
                ref.sizeBytes(), sha, req.contentType(), req.originalName(), req.description(),
                req.region(), null, req.uploadedBy(), false, "stored", traceId, null, null);
        files.insert(row);

        metrics.recordOp(req.category(), target, FileGridMetrics.Op.WRITE,
                FileGridMetrics.Outcome.OK, took);
        metrics.recordBytes(req.category(), target, "in", ref.sizeBytes());
        // Log file_id only — never the document name or content.
        log.info("stored file_id={} category={} storage={} size={}",
                id, req.category().slug(), target.slug(), ref.sizeBytes());

        String signature = signer.sign(id.toString(), req.category().slug(), target.slug(),
                ref.sizeBytes(), sha);
        return new FileReceipt(id.toString(), req.category().slug(), target.slug(),
                ref.sizeBytes(), sha, nowFallback(), false, traceId, signature);
    }

    public FileRow metadata(UUID id) {
        return files.find(id).orElseThrow(() -> ApiException.notFound("no file " + id));
    }

    /**
     * Open a verified stream of the stored bytes. For files within the policy size cap we
     * verify first (a full hashing pass), then hand back a fresh read stream, so a corrupt
     * file fails with a clean 422 BEFORE any body is sent. Larger streamed categories (tus
     * video) verify inline in the P1 work.
     */
    public DownloadStream openForDownload(UUID id) {
        FileRow row = metadata(id);
        Category category = Category.fromSlug(row.category());
        Storage storage = Storage.fromSlug(row.storage());
        StorageAdapter adapter = storages.get(storage);

        String actual = hashStored(adapter, row.objectKey());
        if (actual == null) {
            throw ApiException.notFound("stored object missing for " + id);
        }
        if (!actual.equalsIgnoreCase(row.sha256())) {
            files.markCorrupt(id);
            metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                    FileGridMetrics.Outcome.ERROR, Duration.ZERO);
            metrics.recordIntegrityFailure(category, storage);
            throw new IntegrityException(category, storage, row.sha256(), actual);
        }

        InputStream stream;
        try {
            stream = adapter.read(row.objectKey());
        } catch (Exception e) {
            throw ApiException.storageUnavailable("read from " + storage.slug() + " failed");
        }
        if (stream == null) {
            throw ApiException.notFound("stored object missing for " + id);
        }
        files.markVerified(id);
        metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                FileGridMetrics.Outcome.OK, Duration.ZERO);
        metrics.recordBytes(category, storage, "out", row.sizeBytes());
        return new DownloadStream(stream, row.sha256(), row.sizeBytes(), row.contentType());
    }

    /** POST /files/{id}/verify: re-hash in place and compare, updating last_verified_at. */
    public VerifyResult verify(UUID id) {
        FileRow row = metadata(id);
        Category category = Category.fromSlug(row.category());
        Storage storage = Storage.fromSlug(row.storage());
        StorageAdapter adapter = storages.get(storage);

        long started = System.nanoTime();
        String actual = hashStored(adapter, row.objectKey());
        Duration took = Duration.ofNanos(System.nanoTime() - started);
        boolean ok = actual != null && actual.equalsIgnoreCase(row.sha256());

        if (ok) {
            files.markVerified(id);
            metrics.recordOp(category, storage, FileGridMetrics.Op.VERIFY,
                    FileGridMetrics.Outcome.OK, took);
        } else {
            files.markCorrupt(id);
            metrics.recordOp(category, storage, FileGridMetrics.Op.VERIFY,
                    FileGridMetrics.Outcome.ERROR, took);
            metrics.recordIntegrityFailure(category, storage);
        }
        return new VerifyResult(ok, row.sha256(), actual == null ? "" : actual,
                java.time.OffsetDateTime.now());
    }

    /** Stream the stored object through a digest and return its hex SHA-256; null if missing. */
    private String hashStored(StorageAdapter adapter, String key) {
        try (InputStream in = adapter.read(key)) {
            if (in == null) {
                return null;
            }
            DigestInputStream d = new DigestInputStream(in, Hashing.sha256());
            byte[] buf = new byte[8192];
            while (d.read(buf) != -1) {
                // drain; the digest updates as we read, nothing is buffered
            }
            return Hashing.hex(d.getMessageDigest().digest());
        } catch (Exception e) {
            throw ApiException.storageUnavailable("cannot read stored object: " + e.getMessage());
        }
    }

    /** The current W3C trace id, so a receipt ties back to its request span; null if none. */
    private String currentTraceId() {
        var span = tracer.currentSpan();
        return span == null ? null : span.context().traceId();
    }

    private static java.time.OffsetDateTime nowFallback() {
        return java.time.OffsetDateTime.now();
    }

    /** A verified, open stream plus the facts the controller needs for headers. */
    public record DownloadStream(InputStream stream, String sha256, long sizeBytes, String contentType) {
    }
}
