package ro.ppc.filegrid.files;

import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.audit.AuditLogService;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.common.IntegrityException;
import ro.ppc.filegrid.crypto.CorruptCiphertextException;
import ro.ppc.filegrid.crypto.EnvelopeCrypto;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.FileReceipt;
import ro.ppc.filegrid.files.dto.VerifyResult;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.storage.CountingInputStream;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * Stores and retrieves files with a SHA-256 integrity proof (gating requirement 4), encrypts
 * the categories whose policy says so, and audits the categories whose policy says so.
 *
 * <p>The hash is of the ORIGINAL bytes, taken while they stream in, and recomputed while they
 * stream out, so it proves the same thing whether or not the stored copy is encrypted. For an
 * encrypted file the stored bytes are ciphertext, and a failed authentication (the file was
 * altered in storage) is reported exactly like a hash mismatch. Nothing buffers a whole file.
 *
 * <p>Auditing fails closed: a read is recorded before any byte is released, and if the audit log
 * cannot be written the read is refused. A write and its audit event commit in one transaction.
 */
@Service
public class FileService {

    private static final Logger log = LoggerFactory.getLogger(FileService.class);

    /** Reported as the "actual" hash when stored ciphertext fails authentication. Never valid hex. */
    static final String DECRYPTION_FAILED = "decryption-failed";

    private final PolicyService policy;
    private final StorageRegistry storages;
    private final FileRepository files;
    private final FileGridMetrics metrics;
    private final ReceiptSigner signer;
    private final io.micrometer.tracing.Tracer tracer;
    private final EnvelopeCrypto crypto;
    private final AuditLogService audit;
    private final TransactionTemplate tx;

    public FileService(PolicyService policy, StorageRegistry storages, FileRepository files,
                       FileGridMetrics metrics, ReceiptSigner signer,
                       io.micrometer.tracing.Tracer tracer, EnvelopeCrypto crypto,
                       AuditLogService audit, TransactionTemplate tx) {
        this.policy = policy;
        this.storages = storages;
        this.files = files;
        this.metrics = metrics;
        this.signer = signer;
        this.tracer = tracer;
        this.crypto = crypto;
        this.audit = audit;
        this.tx = tx;
    }

    /** Where a category's bytes go. {@code forceStorage} (admin, Storage Lab) overrides policy. */
    public record UploadRequest(
            Category category, String region, String description, String originalName,
            String contentType, long sizeBytes, String uploadedBy, Storage forceStorage) {
    }

    // ----------------------------------------------------------------- write

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
        boolean encrypt = catPolicy.encrypt();
        EnvelopeCrypto.Envelope envelope = encrypt ? crypto.newEnvelope(id) : null;

        // Count and hash the ORIGINAL bytes as they are pulled; encryption (if any) sits after
        // the digest, so the receipt hash is of the plaintext.
        CountingInputStream counted = new CountingInputStream(body);
        DigestInputStream hashed = new DigestInputStream(counted, Hashing.sha256());
        InputStream toStore = encrypt ? crypto.encrypt(hashed, envelope, id) : hashed;
        Sink sink = new Sink(adapter, target, id, req, toStore, hashed, counted,
                // Ciphertext reveals nothing about the file type, so do not hand the real one to storage.
                encrypt ? "application/octet-stream" : req.contentType(),
                encrypt ? EnvelopeCrypto.ciphertextLength(req.sizeBytes()) : req.sizeBytes());

        Written written;
        try {
            if (target == Storage.DB) {
                // A database file is its blob plus its row, committed together. The blob goes in
                // first (its hash is only known once it has streamed), so the foreign key is
                // checked at commit. A failure rolls the blob back with everything else.
                written = tx.execute(status -> {
                    Written w = write(sink);
                    record(catPolicy, req, id, target, w, encrypt, envelope, traceId);
                    return w;
                });
            } else {
                // FTP and S3 are not part of a database transaction: bytes first, then the row and
                // its audit event together. If that fails, the bytes are removed again.
                Written w = write(sink);
                try {
                    tx.executeWithoutResult(status -> record(catPolicy, req, id, target, w, encrypt, envelope, traceId));
                } catch (RuntimeException e) {
                    try {
                        adapter.delete(id.toString());
                    } catch (Exception ignored) {
                        log.warn("could not remove orphaned object file_id={}", id);
                    }
                    throw e;
                }
                written = w;
            }
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            metrics.recordOp(req.category(), target, FileGridMetrics.Op.WRITE,
                    FileGridMetrics.Outcome.ERROR, Duration.ZERO);
            log.error("recording the file failed file_id={}", id);
            throw ApiException.storageUnavailable("could not record the file; nothing was stored");
        }

        metrics.recordOp(req.category(), target, FileGridMetrics.Op.WRITE,
                FileGridMetrics.Outcome.OK, written.took());
        metrics.recordBytes(req.category(), target, "in", written.plainSize());
        // Log file_id only: never the document name or content.
        log.info("stored file_id={} category={} storage={} size={} encrypted={}",
                id, req.category().slug(), target.slug(), written.plainSize(), encrypt);

        String signature = signer.sign(id.toString(), req.category().slug(), target.slug(),
                written.plainSize(), written.sha());
        return new FileReceipt(id.toString(), req.category().slug(), target.slug(),
                written.plainSize(), written.sha(), java.time.OffsetDateTime.now(), encrypt, traceId, signature);
    }

    /** Everything needed to push one upload into a backend. */
    private record Sink(StorageAdapter adapter, Storage target, UUID id, UploadRequest req, InputStream stream,
                        DigestInputStream hashed, CountingInputStream counted, String storedType, long storedLength) {
    }

    /** What the backend took: the hash and size of the ORIGINAL bytes, and how long it took. */
    private record Written(StoredRef ref, String sha, long plainSize, Duration took) {
    }

    private Written write(Sink s) {
        long started = System.nanoTime();
        StoredRef ref;
        try {
            ref = s.adapter().write(s.stream(), s.id().toString(),
                    WriteMeta.of(s.req().category(), s.storedType(), s.storedLength()));
        } catch (Exception e) {
            metrics.recordOp(s.req().category(), s.target(), FileGridMetrics.Op.WRITE,
                    FileGridMetrics.Outcome.ERROR, Duration.ofNanos(System.nanoTime() - started));
            throw ApiException.storageUnavailable("write to " + s.target().slug() + " failed: " + e.getMessage());
        }
        return new Written(ref, Hashing.hex(s.hashed().getMessageDigest().digest()), s.counted().count(),
                Duration.ofNanos(System.nanoTime() - started));
    }

    /** The files row, and the audit event when the policy asks for one. Runs inside a transaction. */
    private void record(CategoryPolicy catPolicy, UploadRequest req, UUID id, Storage target, Written w,
                        boolean encrypt, EnvelopeCrypto.Envelope envelope, String traceId) {
        FileRow row = new FileRow(id, req.category().slug(), target.slug(), w.ref().key(),
                w.plainSize(), w.sha(), req.contentType(), req.originalName(), req.description(),
                req.region(), null, req.uploadedBy(), encrypt, "stored", traceId, null, null);
        files.insert(row, envelope == null ? null : envelope.wrappedKey(),
                envelope == null ? null : envelope.iv());
        if (catPolicy.auditEnabled()) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("category", row.category());
            details.put("storage", row.storage());
            details.put("size", w.plainSize());
            details.put("sha256", w.sha());
            details.put("encrypted", encrypt);
            audit.append(req.uploadedBy(), "file.write", id, details);
        }
    }

    // ------------------------------------------------------------------ read

    /** Row lookup with no audit entry: for internal use and routes that audit themselves. */
    public FileRow metadata(UUID id) {
        return files.find(id).orElseThrow(() -> ApiException.notFound("no file " + id));
    }

    /** GET /files/{id}: audited when the category's policy asks for it. */
    public FileRow readMetadata(UUID id, String actor) {
        FileRow row = metadata(id);
        audit(row, actor, "file.metadata", Map.of());
        return row;
    }

    /** POST /files/{id}/download-link: the contract audits link use; the minting is recorded too. */
    public FileRow mintLinkFor(UUID id, String actor) {
        FileRow row = metadata(id);
        audit(row, actor, "file.download_link", Map.of());
        return row;
    }

    /**
     * Open a verified stream of the original bytes. The stored object is read and hashed first,
     * then opened again for sending, so a corrupt file fails with a clean 422 BEFORE any body
     * is sent. The access is audited before the first byte is released.
     */
    public DownloadStream openForDownload(UUID id, String actor) {
        long started = System.nanoTime();
        FileRow row = metadata(id);
        Category category = Category.fromSlug(row.category());
        Storage storage = Storage.fromSlug(row.storage());
        StorageAdapter adapter = storages.get(storage);

        String actual = hashStored(adapter, row);
        if (actual == null) {
            throw ApiException.notFound("stored object missing for " + id);
        }
        boolean intact = actual.equalsIgnoreCase(row.sha256());

        // Denied reads are recorded too: an attempt on a tampered document is worth knowing about.
        audit(row, actor, intact ? "file.read" : "file.read_denied",
                Map.of("result", intact ? "ok" : "integrity_failed"));

        if (!intact) {
            files.markCorrupt(id);
            metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                    FileGridMetrics.Outcome.ERROR, Duration.ofNanos(System.nanoTime() - started));
            metrics.recordIntegrityFailure(category, storage);
            throw new IntegrityException(category, storage, row.sha256(), actual);
        }

        InputStream stream;
        try {
            stream = openPlain(adapter, row);
        } catch (Exception e) {
            throw ApiException.storageUnavailable("read from " + storage.slug() + " failed");
        }
        if (stream == null) {
            throw ApiException.notFound("stored object missing for " + id);
        }
        files.markVerified(id);
        metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                FileGridMetrics.Outcome.OK, Duration.ofNanos(System.nanoTime() - started));
        metrics.recordBytes(category, storage, "out", row.sizeBytes());
        return new DownloadStream(stream, row.sha256(), row.sizeBytes(), row.contentType());
    }

    /** POST /files/{id}/verify: re-hash in place and compare, updating last_verified_at. */
    public VerifyResult verify(UUID id, String actor) {
        FileRow row = metadata(id);
        Category category = Category.fromSlug(row.category());
        Storage storage = Storage.fromSlug(row.storage());
        StorageAdapter adapter = storages.get(storage);

        long started = System.nanoTime();
        String actual = hashStored(adapter, row);
        Duration took = Duration.ofNanos(System.nanoTime() - started);
        boolean ok = actual != null && actual.equalsIgnoreCase(row.sha256());

        audit(row, actor, "file.verify", Map.of("result", ok ? "ok" : "integrity_failed"));

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

    // --------------------------------------------------------------- helpers

    /**
     * Opens the stored object as the original bytes: as stored for a clear file, decrypted for an
     * encrypted one. Returns null if the object is missing.
     */
    private InputStream openPlain(StorageAdapter adapter, FileRow row) throws Exception {
        InputStream raw = adapter.read(row.objectKey());
        if (raw == null || !row.encrypted()) {
            return raw;
        }
        FileRepository.Crypto material = files.findCrypto(row.id()).orElseThrow(
                () -> new IllegalStateException("encrypted file has no key material file_id=" + row.id()));
        SecretKey dataKey = crypto.unwrap(material.wrappedKey(), row.id());
        return crypto.decrypt(raw, dataKey, material.iv(), row.id());
    }

    /** Hex SHA-256 of the original bytes as stored; {@link #DECRYPTION_FAILED} if ciphertext was altered; null if missing. */
    private String hashStored(StorageAdapter adapter, FileRow row) {
        try (InputStream in = openPlain(adapter, row)) {
            if (in == null) {
                return null;
            }
            DigestInputStream d = new DigestInputStream(in, Hashing.sha256());
            byte[] buf = new byte[8192];
            while (d.read(buf) != -1) {
                // drain; the digest updates as we read, nothing is buffered
            }
            return Hashing.hex(d.getMessageDigest().digest());
        } catch (CorruptCiphertextException e) {
            return DECRYPTION_FAILED;
        } catch (IOException e) {
            throw ApiException.storageUnavailable("cannot read stored object: " + e.getMessage());
        } catch (ApiException | IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw ApiException.storageUnavailable("cannot read stored object: " + e.getMessage());
        }
    }

    /**
     * Writes an audit event if the file's category asks for one. A failure refuses the operation
     * (503) rather than letting a document be read with no record of it.
     */
    private void audit(FileRow row, String actor, String action, Map<String, Object> extra) {
        if (!policy.policyFor(Category.fromSlug(row.category())).auditEnabled()) {
            return;
        }
        Map<String, Object> details = new LinkedHashMap<>(extra);
        details.put("category", row.category());
        details.put("storage", row.storage());
        try {
            audit.append(actor, action, row.id(), details);
        } catch (RuntimeException e) {
            log.error("audit log write failed file_id={} action={}", row.id(), action);
            throw ApiException.storageUnavailable("audit log unavailable; nothing was released");
        }
    }

    /** The current W3C trace id, so a receipt ties back to its request span; null if none. */
    private String currentTraceId() {
        var span = tracer.currentSpan();
        return span == null ? null : span.context().traceId();
    }

    /** A verified, open stream plus the facts the controller needs for headers. */
    public record DownloadStream(InputStream stream, String sha256, long sizeBytes, String contentType) {
    }
}
