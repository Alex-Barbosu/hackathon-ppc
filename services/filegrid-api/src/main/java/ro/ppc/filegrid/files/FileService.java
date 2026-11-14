package ro.ppc.filegrid.files;

import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
import ro.ppc.filegrid.observability.Spans;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.resilience.Bulkheads;
import ro.ppc.filegrid.resilience.ClientStreamException;
import ro.ppc.filegrid.resilience.StorageDownException;
import ro.ppc.filegrid.resilience.StorageGuard;
import ro.ppc.filegrid.resilience.StorageOp;
import ro.ppc.filegrid.resilience.TrackingInputStream;
import ro.ppc.filegrid.spool.SpoolRepository;
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
 *
 * <p>Writes follow the policy: the primary storage first, and if its circuit is open or the
 * write fails, the policy's fallback (another storage, or the local spool). The client is told
 * the file is stored only after the bytes are durable where they were written.
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
    private final StorageGuard guard;
    private final SpoolRepository spoolItems;
    private final Bulkheads bulkheads;
    private final Spans spans;

    /** Files up to this size are checked first, so a corrupt one gets a clean 422. Larger ones are read once. */
    static final long DEFAULT_VERIFY_FIRST_MAX_BYTES = 64L * 1024 * 1024;
    private volatile long verifyFirstMaxBytes = DEFAULT_VERIFY_FIRST_MAX_BYTES;

    @org.springframework.beans.factory.annotation.Value("${filegrid.download.verify-first-max-bytes:67108864}")
    void setVerifyFirstMaxBytes(long bytes) {
        this.verifyFirstMaxBytes = bytes;
    }

    public FileService(PolicyService policy, StorageRegistry storages, FileRepository files,
                       FileGridMetrics metrics, ReceiptSigner signer,
                       io.micrometer.tracing.Tracer tracer, EnvelopeCrypto crypto,
                       AuditLogService audit, TransactionTemplate tx, StorageGuard guard,
                       SpoolRepository spoolItems, Bulkheads bulkheads, Spans spans) {
        this.policy = policy;
        this.storages = storages;
        this.files = files;
        this.metrics = metrics;
        this.signer = signer;
        this.tracer = tracer;
        this.crypto = crypto;
        this.audit = audit;
        this.tx = tx;
        this.guard = guard;
        this.spoolItems = spoolItems;
        this.bulkheads = bulkheads;
        this.spans = spans;
    }

    /** Where a category's bytes go. {@code forceStorage} (admin, Storage Lab) overrides policy. */
    public record UploadRequest(
            Category category, String region, String county, String description, String originalName,
            String contentType, long sizeBytes, String uploadedBy, Storage forceStorage) {

        /** Without a county: what every caller but an outage upload needs. */
        public UploadRequest(Category category, String region, String description, String originalName,
                             String contentType, long sizeBytes, String uploadedBy, Storage forceStorage) {
            this(category, region, null, description, originalName, contentType, sizeBytes, uploadedBy, forceStorage);
        }
    }

    /**
     * Gives the upload body. Asked once per storage tried: if the primary fails halfway, the
     * fallback needs the bytes from the start, so a new stream is opened for each attempt.
     */
    @FunctionalInterface
    public interface BodySource {
        InputStream open() throws IOException;
    }

    // ----------------------------------------------------------------- write

    /** For a body that can be read only once: no second attempt is possible if the first fails. */
    public FileReceipt store(UploadRequest req, InputStream body) {
        boolean[] used = {false};
        return store(req, () -> {
            if (used[0]) {
                throw new IOException("the request body can only be read once");
            }
            used[0] = true;
            return body;
        });
    }

    public FileReceipt store(UploadRequest req, BodySource source) {
        CategoryPolicy catPolicy = policy.policyFor(req.category());
        if (req.sizeBytes() > catPolicy.maxSizeBytes()) {
            throw ApiException.tooLarge(req.category().slug() + " exceeds maxSizeMb="
                    + catPolicy.maxSizeMb());
        }

        // This category's writes are limited (bulkhead): a storm here waits or is refused here, and the other
        // categories keep their own workers. Over the limit this throws BulkheadFullException (a 503).
        try (Bulkheads.Permit ignored = bulkheads.enter(req.category())) {
            return storeWithFallback(req, source, catPolicy);
        }
    }

    private FileReceipt storeWithFallback(UploadRequest req, BodySource source, CategoryPolicy catPolicy) {
        UUID id = UUID.randomUUID();
        // Every log line of this upload carries its category and file id, inside a span or not.
        try (Spans.Context ignored = Spans.context(req.category(), null, id)) {
            return storeWithFallback(req, source, catPolicy, id);
        }
    }

    private FileReceipt storeWithFallback(UploadRequest req, BodySource source, CategoryPolicy catPolicy, UUID id) {
        List<Storage> plan;
        try (Spans.Scope route = spans.open("policy.route", req.category(), null, id, req.sizeBytes())) {
            plan = plan(req, catPolicy);
            route.tag("filegrid.storage", plan.get(0).slug());
            route.tag("filegrid.fallback_storage", plan.size() > 1 ? plan.get(1).slug() : "none");
            route.tag("filegrid.forced", req.forceStorage() != null);
            route.tag("filegrid.encrypted", catPolicy.encrypt());
            var inForce = policy.current();
            if (inForce != null) {
                route.tag("filegrid.policy_version", inForce.version());
            }
        }
        List<String> tried = new ArrayList<>();
        for (int i = 0; i < plan.size(); i++) {
            Storage target = plan.get(i);
            long started = System.nanoTime();
            try {
                return storeAt(req, source, catPolicy, id, plan.get(0), target, i > 0);
            } catch (StorageDownException e) {
                tried.add(target.slug());
                if (!e.circuitOpen()) {
                    // A refusal by an open circuit never touched the backend, so it is not an error of its own.
                    metrics.recordOp(req.category(), e.storage(), FileGridMetrics.Op.WRITE,
                            FileGridMetrics.Outcome.ERROR, Duration.ofNanos(System.nanoTime() - started));
                } else {
                    // The backend was not called, so there is no write span. Show the skipped attempt in the trace.
                    try (Spans.Scope skipped = spans.open("storage.write", req.category(), e.storage(), id, req.sizeBytes())) {
                        skipped.tag("filegrid.circuit_open", true);
                        skipped.error(e);
                    }
                }
                try (Spans.Context ignored = Spans.context(null, e.storage(), null)) {
                    log.warn("storage unavailable for a write file_id={} category={} storage={} circuitOpen={}",
                            id, req.category().slug(), e.storage().slug(), e.circuitOpen());
                }
            } catch (ClientStreamException e) {
                throw ApiException.badRequest("the upload was interrupted before it finished");
            }
        }
        throw ApiException.storageUnavailable("no storage could take the file (tried " + String.join(", ", tried) + ")");
    }

    /** Storages to try, in order: the policy's primary then its fallback. A forced storage has no fallback. */
    private List<Storage> plan(UploadRequest req, CategoryPolicy catPolicy) {
        if (req.forceStorage() != null) {
            return List.of(req.forceStorage());
        }
        Storage primary = policy.primaryStorageFor(req.category());
        Storage fallback = policy.fallbackStorageFor(req.category());
        return fallback == primary ? List.of(primary) : List.of(primary, fallback);
    }

    private FileReceipt storeAt(UploadRequest req, BodySource source, CategoryPolicy catPolicy, UUID id,
                                Storage intended, Storage target, boolean fallback) {
        String traceId = currentTraceId();
        boolean encrypt = catPolicy.encrypt();
        // A fresh key per attempt: nothing from a failed attempt is reused.
        EnvelopeCrypto.Envelope envelope = encrypt ? crypto.newEnvelope(id) : null;
        StorageAdapter adapter = storages.get(target);

        try (InputStream raw = source.open()) {
            // Count and hash the ORIGINAL bytes as they are pulled; encryption (if any) sits after
            // the digest, so the receipt hash is of the plaintext.
            // An outage configuration file (.cfg) keeps the first bytes for its metadata; nothing else is copied.
            HeadCapturingInputStream head = req.category() == Category.OUTAGE && ComtradeCfg.looksLikeConfig(req.originalName())
                    ? new HeadCapturingInputStream(raw, ComtradeCfg.MAX_HEAD) : null;
            TrackingInputStream tracked = new TrackingInputStream(head != null ? head : raw);
            CountingInputStream counted = new CountingInputStream(tracked);
            DigestInputStream hashed = new DigestInputStream(counted, Hashing.sha256());
            InputStream toStore = encrypt ? crypto.encrypt(hashed, envelope, id) : hashed;
            Sink sink = new Sink(adapter, target, id, req, toStore, tracked, hashed, counted,
                    // Ciphertext reveals nothing about the file type, so do not hand the real one to storage.
                    encrypt ? "application/octet-stream" : req.contentType(),
                    encrypt ? EnvelopeCrypto.ciphertextLength(req.sizeBytes()) : req.sizeBytes(), fallback, head);

            Written written = persist(sink, catPolicy, intended, encrypt, envelope, traceId);

            metrics.recordOp(req.category(), target, FileGridMetrics.Op.WRITE,
                    fallback ? FileGridMetrics.Outcome.FALLBACK : FileGridMetrics.Outcome.OK, written.took());
            metrics.recordBytes(req.category(), target, "in", written.plainSize());
            // Log file_id only: never the document name or content.
            try (Spans.Context ignored = Spans.context(req.category(), target, id)) {
                log.info("stored file_id={} category={} storage={} size={} encrypted={} fallback={}",
                        id, req.category().slug(), target.slug(), written.plainSize(), encrypt, fallback);
            }

            String signature = signer.sign(id.toString(), req.category().slug(), target.slug(),
                    written.plainSize(), written.sha());
            return new FileReceipt(id.toString(), req.category().slug(), target.slug(),
                    written.plainSize(), written.sha(), java.time.OffsetDateTime.now(), encrypt, traceId, signature);
        } catch (IOException e) {
            throw ApiException.badRequest("cannot read the upload");
        }
    }

    /**
     * Gets the bytes onto {@code sink.target()} and records the file. Throws
     * {@link StorageDownException} if that storage cannot take it, so the caller can try the fallback.
     */
    private Written persist(Sink sink, CategoryPolicy catPolicy, Storage intended, boolean encrypt,
                            EnvelopeCrypto.Envelope envelope, String traceId) {
        Storage target = sink.target();
        UploadRequest req = sink.req();
        UUID id = sink.id();

        if (target == Storage.DB) {
            // A database file is its blob plus its row, committed together. The blob goes in first (its
            // hash is only known once it has streamed), so the foreign key is checked at commit. A failure
            // rolls the blob back with everything else, and counts against the database circuit.
            return guard.call(Storage.DB, () -> tx.execute(status -> {
                Written w = writeUnchecked(sink);
                record(catPolicy, req, id, target, intended, w, encrypt, envelope, traceId, metadataOf(sink));
                return w;
            }));
        }

        Written w;
        if (target == Storage.SPOOL) {
            // The spool is local disk: no circuit, and a failure here is a real error.
            try {
                w = write(sink);
            } catch (ClientStreamException e) {
                throw e;
            } catch (Exception e) {
                log.error("the spool could not take the file file_id={}", id);
                throw ApiException.storageUnavailable("the spool could not take the file");
            }
        } else {
            w = guard.call(target, () -> write(sink));
        }

        // FTP, S3 and the spool are not part of a database transaction: bytes first, then the row and its
        // audit event together. If recording fails the bytes are removed again, so nothing is left orphaned.
        try {
            guard.call(Storage.DB, () -> {
                tx.executeWithoutResult(status ->
                        record(catPolicy, req, id, target, intended, w, encrypt, envelope, traceId, metadataOf(sink)));
                return null;
            });
        } catch (RuntimeException e) {
            removeQuietly(sink.adapter(), w.ref().key(), id);
            // The database is needed for any fallback too, so do not try another storage.
            log.error("recording the file failed file_id={}", id);
            throw ApiException.storageUnavailable("could not record the file; nothing was stored");
        }
        return w;
    }

    /** Everything needed to push one upload into a backend. */
    private record Sink(StorageAdapter adapter, Storage target, UUID id, UploadRequest req, InputStream stream,
                        TrackingInputStream tracked, DigestInputStream hashed, CountingInputStream counted,
                        String storedType, long storedLength, boolean fallback, HeadCapturingInputStream head) {
    }

    /** What the backend took: the hash and size of the ORIGINAL bytes, and how long it took. */
    private record Written(StoredRef ref, String sha, long plainSize, Duration took) {
    }

    private Written write(Sink s) throws Exception {
        long started = System.nanoTime();
        StoredRef ref;
        try (Spans.Scope span = spans.open("storage.write", s.req().category(), s.target(), s.id(), s.req().sizeBytes())) {
            span.tag("filegrid.fallback", s.fallback());
            try {
                ref = s.adapter().write(s.stream(), s.id().toString(),
                        WriteMeta.of(s.req().category(), s.storedType(), s.storedLength()));
            } catch (Exception e) {
                span.error(e);
                if (s.tracked().failed()) {
                    // Reading the request body failed: the client's connection, not this storage.
                    throw new ClientStreamException(s.tracked().failure());
                }
                throw e;
            }
        }
        return new Written(ref, Hashing.hex(s.hashed().getMessageDigest().digest()), s.counted().count(),
                Duration.ofNanos(System.nanoTime() - started));
    }

    /** {@link #write} for use inside a transaction callback, which cannot throw a checked exception. */
    private Written writeUnchecked(Sink s) {
        try {
            return write(s);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("the database write failed", e);
        }
    }

    /**
     * What the file's own content says about it, as JSON for {@code files.metadata}: for now the COMTRADE configuration
     * of an outage record (station, fault time...). Null when there is nothing to say, which is the usual case. It
     * never fails an upload: a file that cannot be read this way is stored like any other.
     */
    private static String metadataOf(Sink sink) {
        if (sink.head() == null) {
            return null;
        }
        return ComtradeCfg.metadataJson(sink.head().head(), sink.head().head().length).orElse(null);
    }

    /** The files row, its audit event when the policy asks for one, and the spool index when parked. */
    private void record(CategoryPolicy catPolicy, UploadRequest req, UUID id, Storage target, Storage intended,
                        Written w, boolean encrypt, EnvelopeCrypto.Envelope envelope, String traceId,
                        String metadataJson) {
        boolean parked = target == Storage.SPOOL;
        FileRow row = new FileRow(id, req.category().slug(), target.slug(), w.ref().key(),
                w.plainSize(), w.sha(), req.contentType(), req.originalName(), req.description(),
                req.region(), req.county(), req.uploadedBy(), encrypt, parked ? "spooled" : "stored", traceId, null, null);
        if (metadataJson == null) {
            files.insert(row, envelope == null ? null : envelope.wrappedKey(),
                    envelope == null ? null : envelope.iv());
        } else {
            files.insert(row, envelope == null ? null : envelope.wrappedKey(),
                    envelope == null ? null : envelope.iv(), metadataJson);
        }
        if (parked) {
            spoolItems.insert(id, req.category(), intended, w.ref().key());
        }
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

    private void removeQuietly(StorageAdapter adapter, String key, UUID id) {
        try {
            adapter.delete(key);
        } catch (Exception ignored) {
            log.warn("could not remove orphaned object file_id={}", id);
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

        if (row.sizeBytes() > verifyFirstMaxBytes) {
            return openSinglePass(row, category, storage, adapter, actor, started);
        }

        String actual = checkIntegrity(adapter, row, category, storage);
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

        // This span is open until the client has the last byte (the stream is closed), so its length is the
        // real time spent reading from storage for this download.
        Spans.Scope delivery = spans.start("storage.read", category, storage, id, row.sizeBytes());
        delivery.tag("filegrid.purpose", "download");
        InputStream opened;
        try {
            opened = openPlain(adapter, row);
        } catch (Exception e) {
            delivery.error(e);
            delivery.close();
            throw ApiException.storageUnavailable("read from " + storage.slug() + " failed");
        }
        if (opened == null) {
            delivery.close();
            throw ApiException.notFound("stored object missing for " + id);
        }
        InputStream stream = spans.endOnClose(delivery, opened);
        files.markVerified(id);
        metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                FileGridMetrics.Outcome.OK, Duration.ofNanos(System.nanoTime() - started));
        metrics.recordBytes(category, storage, "out", row.sizeBytes());
        return new DownloadStream(stream, row.sha256(), row.sizeBytes(), row.contentType());
    }

    /**
     * A large file (over {@code filegrid.download.verify-first-max-bytes}) is read once: the first byte goes out at once and
     * the hash is built on the way. The last chunk is held back until the hash matches (see {@link VerifyingInputStream}), so a
     * corrupt file never ends as a complete download, but it is a cut-short response, not a clean 422, because the status line
     * is already sent. The read is audited before the first byte as {@code result=streaming}; a mismatch adds a
     * {@code file.read_denied} event when it is found.
     */
    private DownloadStream openSinglePass(FileRow row, Category category, Storage storage, StorageAdapter adapter,
                                          String actor, long started) {
        UUID id = row.id();
        audit(row, actor, "file.read", Map.of("result", "streaming"));

        Spans.Scope delivery = spans.start("storage.read", category, storage, id, row.sizeBytes());
        delivery.tag("filegrid.purpose", "download");
        Spans.Scope verify = spans.start("integrity.verify", category, storage, id, row.sizeBytes());
        verify.tag("filegrid.single_pass", true);
        InputStream opened;
        try {
            opened = openPlain(adapter, row);
        } catch (Exception e) {
            delivery.error(e);
            delivery.close();
            verify.error(e);
            verify.close();
            throw ApiException.storageUnavailable("read from " + storage.slug() + " failed");
        }
        if (opened == null) {
            delivery.close();
            verify.close();
            throw ApiException.notFound("stored object missing for " + id);
        }

        VerifyingInputStream.Listener done = new VerifyingInputStream.Listener() {
            @Override
            public void verified() {
                verify.tag("filegrid.integrity_ok", true);
                verify.close();
                files.markVerified(id);
                metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                        FileGridMetrics.Outcome.OK, Duration.ofNanos(System.nanoTime() - started));
                metrics.recordBytes(category, storage, "out", row.sizeBytes());
            }

            @Override
            public void failed(String actual) {
                verify.tag("filegrid.integrity_ok", false);
                verify.error(new IntegrityException(category, storage, row.sha256(), actual));
                verify.close();
                files.markCorrupt(id);
                metrics.recordOp(category, storage, FileGridMetrics.Op.READ,
                        FileGridMetrics.Outcome.ERROR, Duration.ofNanos(System.nanoTime() - started));
                metrics.recordIntegrityFailure(category, storage);
                log.warn("integrity failure during a download file_id={} category={} storage={}",
                        id, category.slug(), storage.slug());
                try {
                    audit(row, actor, "file.read_denied", Map.of("result", "integrity_failed"));
                } catch (RuntimeException e) {
                    // The download is already cut short; audit() has logged why the event could not be written.
                }
            }

            @Override
            public void closedEarly() {
                verify.tag("filegrid.aborted", true);
                verify.close();
            }
        };
        InputStream stream = spans.endOnClose(delivery, new VerifyingInputStream(opened, row.sha256(), done));
        return new DownloadStream(stream, row.sha256(), row.sizeBytes(), row.contentType());
    }

    /**
     * DELETE /files/{id}: removes the stored bytes from whichever storage holds them, then the row, and records
     * {@code file.delete} where the category's policy audits. The row and its audit event commit together, so a
     * failed audit leaves the file in place. If the storage cannot be reached the row stays (503), so no object is
     * left behind with nothing pointing at it; the bytes' removal is safe to repeat.
     */
    public void delete(UUID id, String actor) {
        FileRow row = metadata(id);
        Category category = Category.fromSlug(row.category());
        Storage storage = Storage.fromSlug(row.storage());
        StorageAdapter adapter = storages.get(storage);

        // A file still waiting in the spool has copies in the spool table: drop them first so no replay starts.
        spoolItems.deleteByFile(id);
        try {
            guarded(adapter, () -> {
                adapter.delete(row.objectKey());
                return Boolean.TRUE;
            });
        } catch (StorageDownException e) {
            throw ApiException.storageUnavailable("cannot reach " + storage.slug() + " to delete the file");
        } catch (Exception e) {
            log.warn("deleting the stored object failed file_id={} storage={}", id, storage.slug());
            throw ApiException.storageUnavailable("deleting from " + storage.slug() + " failed");
        }
        tx.executeWithoutResult(status -> {
            files.delete(id);
            audit(row, actor, "file.delete", Map.of());
        });
        log.info("deleted file_id={} category={} storage={}", id, category.slug(), storage.slug());
    }

    /** POST /files/{id}/verify: re-hash in place and compare, updating last_verified_at. */
    public VerifyResult verify(UUID id, String actor) {
        FileRow row = metadata(id);
        Category category = Category.fromSlug(row.category());
        Storage storage = Storage.fromSlug(row.storage());
        StorageAdapter adapter = storages.get(storage);

        long started = System.nanoTime();
        String actual = checkIntegrity(adapter, row, category, storage);
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
     * encrypted one. Returns null if the object is missing. The open goes through the storage's
     * circuit, so a storage known to be down answers at once instead of making the caller wait.
     */
    private InputStream openPlain(StorageAdapter adapter, FileRow row) throws Exception {
        InputStream raw = guarded(adapter, () -> adapter.read(row.objectKey()));
        if (raw == null || !row.encrypted()) {
            return raw;
        }
        FileRepository.Crypto material = files.findCrypto(row.id()).orElseThrow(
                () -> new IllegalStateException("encrypted file has no key material file_id=" + row.id()));
        SecretKey dataKey = crypto.unwrap(material.wrappedKey(), row.id());
        return crypto.decrypt(raw, dataKey, material.iv(), row.id());
    }

    private <T> T guarded(StorageAdapter adapter, StorageOp<T> op) throws Exception {
        // The spool is local disk and has no circuit.
        return adapter.kind() == Storage.SPOOL ? op.run() : guard.call(adapter.kind(), op);
    }

    /**
     * The hashing pass, as two spans: {@code integrity.verify} (is the stored file what was recorded?) around
     * {@code storage.read} (the reading of it). A mismatch or a failed decryption marks the verify span as failed.
     */
    private String checkIntegrity(StorageAdapter adapter, FileRow row, Category category, Storage storage) {
        try (Spans.Scope verify = spans.open("integrity.verify", category, storage, row.id(), row.sizeBytes())) {
            String actual;
            try (Spans.Scope read = spans.open("storage.read", category, storage, row.id(), row.sizeBytes())) {
                try {
                    actual = hashStored(adapter, row);
                } catch (RuntimeException e) {
                    read.error(e);
                    verify.error(e);
                    throw e;
                }
            }
            if (actual == null) {
                verify.tag("filegrid.missing", true);
            } else {
                boolean intact = actual.equalsIgnoreCase(row.sha256());
                verify.tag("filegrid.integrity_ok", intact);
                if (!intact) {
                    verify.error(new IntegrityException(category, storage, row.sha256(), actual));
                }
            }
            return actual;
        }
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
