package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.micrometer.tracing.Tracer;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.audit.AuditLogService;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.crypto.EnvelopeCrypto;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.FileReceipt;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.resilience.StorageGuard;
import ro.ppc.filegrid.spool.SpoolRepository;
import ro.ppc.filegrid.spool.SpoolStorage;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * The write path when a storage is down: the policy's fallback takes the file, a circuit that is
 * open is not called at all, the upload body is read again from the start for the fallback, and a
 * client that drops its connection is never mistaken for a storage failure.
 */
class FileServiceFallbackTest {

    @TempDir
    Path spoolDir;

    private SimpleMeterRegistry registry;
    private StorageGuard guard;
    private FlakyStorage s3;
    private FlakyStorage db;
    private FlakyStorage ftp;
    private SpoolStorage spool;
    private FileRepository repo;
    private SpoolRepository spoolItems;
    private FileService service;
    private FileRow savedRow;
    private PolicyService policy;
    private final io.micrometer.tracing.test.simple.SimpleTracer tracer = new io.micrometer.tracing.test.simple.SimpleTracer();
    private final ro.ppc.filegrid.observability.Spans spans = new ro.ppc.filegrid.observability.Spans(tracer);
    private ro.ppc.filegrid.resilience.Bulkheads bulkheads;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        guard = new StorageGuard(registry, 10, 3, 50f, 3600);
        s3 = new FlakyStorage(Storage.S3);
        db = new FlakyStorage(Storage.DB);
        ftp = new FlakyStorage(Storage.FTP);
        spool = new SpoolStorage(spoolDir.toString());

        policy = mock(PolicyService.class);
        // The default policy: outage s3 -> db, video s3 -> spool, document ftp -> s3 (encrypted).
        when(policy.policyFor(Category.OUTAGE)).thenReturn(new CategoryPolicy("s3", "db", false, 20, "high", 8, 500, null, null));
        when(policy.policyFor(Category.VIDEO)).thenReturn(new CategoryPolicy("s3", "spool", false, 5000, "low", 2, 20, null, 16));
        when(policy.policyFor(Category.DOCUMENT)).thenReturn(new CategoryPolicy("ftp", "s3", true, 20, "normal", 4, 200, null, null));
        when(policy.primaryStorageFor(Category.OUTAGE)).thenReturn(Storage.S3);
        when(policy.fallbackStorageFor(Category.OUTAGE)).thenReturn(Storage.DB);
        when(policy.primaryStorageFor(Category.VIDEO)).thenReturn(Storage.S3);
        when(policy.fallbackStorageFor(Category.VIDEO)).thenReturn(Storage.SPOOL);
        when(policy.primaryStorageFor(Category.DOCUMENT)).thenReturn(Storage.FTP);
        when(policy.fallbackStorageFor(Category.DOCUMENT)).thenReturn(Storage.S3);

        StorageRegistry storages = mock(StorageRegistry.class);
        when(storages.get(Storage.S3)).thenReturn(s3);
        when(storages.get(Storage.DB)).thenReturn(db);
        when(storages.get(Storage.FTP)).thenReturn(ftp);
        when(storages.get(Storage.SPOOL)).thenReturn(spool);

        repo = mock(FileRepository.class);
        doAnswer(inv -> {
            savedRow = inv.getArgument(0);
            return null;
        }).when(repo).insert(any(FileRow.class), any(), any());
        when(repo.find(any())).thenAnswer(inv -> Optional.ofNullable(savedRow));
        when(repo.findCrypto(any())).thenReturn(Optional.empty());

        spoolItems = mock(SpoolRepository.class);
        TransactionTemplate tx = new TransactionTemplate() {
            @Override
            public <T> T execute(TransactionCallback<T> action) {
                return action.doInTransaction(null);
            }
        };
        bulkheads = new ro.ppc.filegrid.resilience.Bulkheads(policy, registry, java.time.Duration.ofMillis(300));
        service = new FileService(policy, storages, repo, new FileGridMetrics(registry),
                new ReceiptSigner("test-secret-for-receipts"), mock(Tracer.class), new EnvelopeCrypto("ab".repeat(32)),
                mock(AuditLogService.class), tx, guard, spoolItems, bulkheads, spans);
    }

    private static byte[] bytes(int n) {
        byte[] b = new byte[n];
        new java.util.Random(3).nextBytes(b);
        return b;
    }

    private static String sha256(byte[] b) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
    }

    private FileService.UploadRequest request(Category c, int size, Storage force) {
        return new FileService.UploadRequest(c, "banat", null, "name.bin", "application/octet-stream", size, "tester", force);
    }

    private FileReceipt upload(Category c, byte[] data) {
        return service.store(request(c, data.length, null), () -> new ByteArrayInputStream(data));
    }

    private double ops(Category c, Storage s, String outcome) {
        var counter = registry.find("filegrid.ops").tags("category", c.slug(), "storage", s.slug(), "op", "write",
                "outcome", outcome).counter();
        return counter == null ? 0 : counter.count();
    }

    private void breakCircuit(Storage s) {
        for (int i = 0; i < 3; i++) {
            try {
                guard.call(s, () -> {
                    throw new IOException("refused");
                });
            } catch (RuntimeException expected) {
                // each failure counts toward opening the circuit
            }
        }
        assertThat(guard.isOpen(s)).isTrue();
    }

    // ------------------------------------------------------------------ a healthy primary

    @Test
    void aHealthyPrimaryTakesTheFileAndNothingIsCountedAsAFallback() throws Exception {
        byte[] data = bytes(5000);

        FileReceipt r = upload(Category.OUTAGE, data);

        assertThat(r.storage()).isEqualTo("s3");
        assertThat(s3.objects.get(r.id())).isEqualTo(data);
        assertThat(ops(Category.OUTAGE, Storage.S3, "ok")).isEqualTo(1);
        assertThat(ops(Category.OUTAGE, Storage.DB, "fallback")).isZero();
        assertThat(db.writeAttempts.get()).isZero();
    }

    // ------------------------------------------------------------------ the primary is down

    @Test
    void whenThePrimaryFailsThePolicysFallbackTakesTheFile() throws Exception {
        byte[] data = bytes(5000);
        s3.failImmediately = true;

        FileReceipt r = upload(Category.OUTAGE, data);

        assertThat(r.storage()).as("outage falls back to db").isEqualTo("db");
        assertThat(db.objects.get(r.id())).isEqualTo(data);
        assertThat(r.sha256()).isEqualTo(sha256(data));
        assertThat(savedRow.storage()).isEqualTo("db");
        assertThat(savedRow.status()).isEqualTo("stored");
        assertThat(ops(Category.OUTAGE, Storage.S3, "error")).as("the refused write is an error on s3").isEqualTo(1);
        assertThat(ops(Category.OUTAGE, Storage.DB, "fallback")).as("and the fallback write is counted as one").isEqualTo(1);
    }

    @Test
    void theFallbackGetsTheWholeFileEvenIfThePrimaryReadHalfOfItFirst() throws Exception {
        byte[] data = bytes(200_000);
        s3.failAfterBytes = 90_000; // reads part of the body, then the connection to s3 dies
        AtomicInteger opened = new AtomicInteger();

        FileReceipt r = service.store(request(Category.OUTAGE, data.length, null), () -> {
            opened.incrementAndGet();
            return new ByteArrayInputStream(data);
        });

        assertThat(opened).as("the body is opened again for the fallback").hasValue(2);
        assertThat(db.objects.get(r.id())).as("nothing is missing or doubled").isEqualTo(data);
        assertThat(r.sha256()).isEqualTo(sha256(data));
    }

    @Test
    void anOpenCircuitIsSkippedWithoutTouchingThePrimary() throws Exception {
        s3.failImmediately = true;
        for (int i = 0; i < 3; i++) {
            upload(Category.OUTAGE, bytes(100)); // three failures open the circuit
        }
        assertThat(guard.isOpen(Storage.S3)).isTrue();
        int attemptsBefore = s3.writeAttempts.get();

        FileReceipt r = upload(Category.OUTAGE, bytes(100));

        assertThat(r.storage()).isEqualTo("db");
        assertThat(s3.writeAttempts.get()).as("s3 was not called").isEqualTo(attemptsBefore);
        assertThat(ops(Category.OUTAGE, Storage.S3, "error")).as("a skipped call is not another error").isEqualTo(3);
        assertThat(ops(Category.OUTAGE, Storage.DB, "fallback")).isEqualTo(4);
    }

    @Test
    void aVideoFallsBackToTheSpoolAndIsParkedForReplay() throws Exception {
        byte[] data = bytes(300_000);
        s3.failImmediately = true;

        FileReceipt r = upload(Category.VIDEO, data);

        assertThat(r.storage()).isEqualTo("spool");
        assertThat(Files.readAllBytes(spoolDir.resolve("video").resolve(r.id())))
                .as("the file is on disk before the client is told it is stored").isEqualTo(data);
        assertThat(savedRow.storage()).isEqualTo("spool");
        assertThat(savedRow.status()).isEqualTo("spooled");
        assertThat(savedRow.objectKey()).isEqualTo("video/" + r.id());
        // The index remembers where it belongs, not where it waits.
        verify(spoolItems).insert(UUID.fromString(r.id()), Category.VIDEO, Storage.S3, "video/" + r.id());
        assertThat(ops(Category.VIDEO, Storage.SPOOL, "fallback")).isEqualTo(1);
    }

    @Test
    void aParkedFileCanBeReadBackFromTheSpool() throws Exception {
        byte[] data = bytes(100_000);
        s3.failImmediately = true;
        FileReceipt r = upload(Category.VIDEO, data);

        var download = service.openForDownload(UUID.fromString(r.id()), "tester");

        try (InputStream in = download.stream()) {
            assertThat(in.readAllBytes()).isEqualTo(data);
        }
        assertThat(download.sha256()).isEqualTo(sha256(data));
    }

    @Test
    void anEncryptedDocumentThatFallsBackStillOnlyReachesStorageAsCiphertext() throws Exception {
        byte[] data = new byte[10_000];
        java.util.Arrays.fill(data, (byte) 'P'); // an easy pattern to look for
        ftp.failImmediately = true;

        FileReceipt r = upload(Category.DOCUMENT, data);

        assertThat(r.storage()).as("document falls back to s3").isEqualTo("s3");
        assertThat(r.encrypted()).isTrue();
        assertThat(new String(s3.objects.get(r.id()), java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain("PPPPPPPP");
        assertThat(ops(Category.DOCUMENT, Storage.FTP, "error")).isEqualTo(1);
        assertThat(ops(Category.DOCUMENT, Storage.S3, "fallback")).isEqualTo(1);
    }

    // ------------------------------------------------------------------ both down, forced, client

    @Test
    void ifThePrimaryAndTheFallbackAreBothDownTheClientGetsA503AndNothingIsRecorded() {
        s3.failImmediately = true;
        db.failImmediately = true;

        assertThatThrownBy(() -> upload(Category.OUTAGE, bytes(100)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));

        assertThat(savedRow).isNull();
        verify(repo, never()).insert(any(FileRow.class), any(), any());
    }

    @Test
    void aForcedStorageHasNoFallback() {
        s3.failImmediately = true;

        assertThatThrownBy(() -> service.store(request(Category.OUTAGE, 100, Storage.S3),
                () -> new ByteArrayInputStream(bytes(100))))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));

        assertThat(db.writeAttempts.get()).as("the Storage Lab asked for s3 specifically").isZero();
    }

    @Test
    void aClientThatDropsItsConnectionIsNotAStorageFailure() {
        byte[] data = bytes(50_000);
        for (int i = 0; i < 12; i++) {
            assertThatThrownBy(() -> service.store(request(Category.OUTAGE, data.length, null), () -> new InputStream() {
                int sent;

                @Override
                public int read() throws IOException {
                    if (sent++ > 1000) {
                        throw new IOException("connection reset by peer");
                    }
                    return 1;
                }
            })).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(400));
        }

        assertThat(guard.allows(Storage.S3)).as("twelve broken clients did not open the s3 circuit").isTrue();
        assertThat(ops(Category.OUTAGE, Storage.S3, "error")).isZero();
        assertThat(db.writeAttempts.get()).as("and the fallback was not used for them").isZero();
    }

    // ------------------------------------------------------------------ spans

    private java.util.List<io.micrometer.tracing.test.simple.SimpleSpan> spansNamed(String name) {
        return tracer.getSpans().stream().filter(s -> s.getName().equals(name)).toList();
    }

    @Test
    void anUploadShowsWhereThePolicySentItAndTheWrite() throws Exception {
        FileReceipt r = upload(Category.OUTAGE, bytes(5000));

        var route = spansNamed("policy.route");
        var write = spansNamed("storage.write");
        assertThat(route).hasSize(1);
        assertThat(route.get(0).getTags()).containsEntry("filegrid.category", "outage").containsEntry("filegrid.storage", "s3")
                .containsEntry("filegrid.fallback_storage", "db").containsEntry("filegrid.forced", "false")
                .containsEntry("filegrid.file_id", r.id());
        assertThat(write).hasSize(1);
        assertThat(write.get(0).getTags()).containsEntry("filegrid.category", "outage").containsEntry("filegrid.storage", "s3")
                .containsEntry("filegrid.file_id", r.id()).containsEntry("filegrid.size_bytes", "5000")
                .containsEntry("filegrid.fallback", "false");
        assertThat(write.get(0).getError()).isNull();
        assertThat(write.get(0).getEndTimestamp()).as("ended").isNotEqualTo(java.time.Instant.EPOCH);
    }

    @Test
    void aFallbackShowsAsAFailedWriteThenASuccessfulOneOnTheFallbackStorage() throws Exception {
        s3.failImmediately = true;

        FileReceipt r = upload(Category.OUTAGE, bytes(5000));

        var write = spansNamed("storage.write");
        assertThat(write).hasSize(2);
        assertThat(write.get(0).getTags()).containsEntry("filegrid.storage", "s3").containsEntry("filegrid.fallback", "false");
        assertThat(write.get(0).getError()).as("the refused write is red in the trace").isNotNull();
        assertThat(write.get(1).getTags()).containsEntry("filegrid.storage", "db").containsEntry("filegrid.fallback", "true")
                .containsEntry("filegrid.file_id", r.id());
        assertThat(write.get(1).getError()).isNull();
    }

    @Test
    void aWriteSkippedByAnOpenCircuitIsStillVisibleInTheTrace() throws Exception {
        s3.failImmediately = true;
        for (int i = 0; i < 3; i++) {
            upload(Category.OUTAGE, bytes(100));
        }
        tracer.getSpans().clear();

        upload(Category.OUTAGE, bytes(100));

        var write = spansNamed("storage.write");
        assertThat(write).extracting(sp -> sp.getTags().get("filegrid.storage")).containsExactly("s3", "db");
        assertThat(write.get(0).getTags()).containsEntry("filegrid.circuit_open", "true");
        assertThat(write.get(0).getError()).isNotNull();
    }

    @Test
    void aDownloadHasAVerifyingPassAroundAReadAndADeliveryReadThatLastsUntilTheStreamIsClosed() throws Exception {
        FileReceipt r = upload(Category.OUTAGE, bytes(5000));
        tracer.getSpans().clear();

        var dl = service.openForDownload(UUID.fromString(r.id()), "tester");

        var verify = spansNamed("integrity.verify");
        assertThat(verify).hasSize(1);
        assertThat(verify.get(0).getTags()).containsEntry("filegrid.integrity_ok", "true").containsEntry("filegrid.storage", "s3")
                .containsEntry("filegrid.file_id", r.id());
        var reads = spansNamed("storage.read");
        assertThat(reads).hasSize(2);
        assertThat(reads.get(0).context().parentId()).as("the read inside the check is its child").isEqualTo(verify.get(0).context().spanId());
        assertThat(reads.get(1).getTags()).containsEntry("filegrid.purpose", "download");
        assertThat(reads.get(1).getEndTimestamp()).as("still open: the client is still receiving").isEqualTo(java.time.Instant.EPOCH);

        dl.stream().readAllBytes();
        dl.stream().close();

        assertThat(reads.get(1).getEndTimestamp()).as("ended when the stream closed").isNotEqualTo(java.time.Instant.EPOCH);
        assertThat(reads.get(1).getTags()).containsEntry("filegrid.bytes_read", "5000");
    }

    @Test
    void aFileThatFailsItsCheckHasAFailedVerifySpan() throws Exception {
        FileReceipt r = upload(Category.OUTAGE, bytes(5000));
        s3.objects.get(r.id())[100] ^= 1;
        tracer.getSpans().clear();

        assertThatThrownBy(() -> service.openForDownload(UUID.fromString(r.id()), "tester"))
                .isInstanceOf(ro.ppc.filegrid.common.IntegrityException.class);

        var verify = spansNamed("integrity.verify").get(0);
        assertThat(verify.getTags()).containsEntry("filegrid.integrity_ok", "false");
        assertThat(verify.getError()).as("red in the trace, with the cause").isNotNull();
        assertThat(spansNamed("storage.read")).as("no delivery read: nothing was sent").hasSize(1);
    }

    @Test
    void noSpanOrLogContextEverHoldsTheFileName() throws Exception {
        var req = new FileService.UploadRequest(Category.OUTAGE, "banat", null, "Ion Popescu - contract.pdf",
                "application/pdf", 3000, "connections", null);
        FileReceipt r = service.store(req, () -> new ByteArrayInputStream(bytes(3000)));
        service.openForDownload(UUID.fromString(r.id()), "alice").stream().close();

        assertThat(tracer.getSpans()).isNotEmpty();
        for (var span : tracer.getSpans()) {
            assertThat(span.getName()).doesNotContain("Popescu");
            assertThat(span.getTags().toString()).doesNotContain("Popescu").doesNotContain("contract");
            assertThat(String.valueOf(span.getError())).doesNotContain("Popescu");
        }
    }

    // ------------------------------------------------------------------ bulkheads

    private static CategoryPolicy outageLimits(int workers, int queue) {
        return new CategoryPolicy("s3", "db", false, 20, "high", workers, queue, false, null);
    }

    @Test
    void aCategoryAtCapacityIsRefusedBeforeAnyStorageIsTouched() throws Exception {
        when(policy.policyFor(Category.OUTAGE)).thenReturn(outageLimits(1, 0));

        try (var held = bulkheads.enter(Category.OUTAGE)) {
            assertThatThrownBy(() -> upload(Category.OUTAGE, bytes(100)))
                    .isInstanceOf(ro.ppc.filegrid.resilience.BulkheadFullException.class);
        }

        assertThat(s3.writeAttempts.get()).as("no storage call was made for the refused upload").isZero();
        assertThat(savedRow).isNull();
        assertThat(guard.allows(Storage.S3)).as("and a refusal is not a storage failure").isTrue();
        assertThat(upload(Category.OUTAGE, bytes(100)).storage()).as("the worker is free again").isEqualTo("s3");
    }

    @Test
    void aStormInOutageDoesNotStopUploadsInOtherCategories() throws Exception {
        when(policy.policyFor(Category.OUTAGE)).thenReturn(outageLimits(1, 0));

        try (var held = bulkheads.enter(Category.OUTAGE)) {
            assertThatThrownBy(() -> upload(Category.OUTAGE, bytes(100)))
                    .isInstanceOf(ro.ppc.filegrid.resilience.BulkheadFullException.class);

            assertThat(upload(Category.VIDEO, bytes(100)).storage()).isEqualTo("s3");
            assertThat(upload(Category.DOCUMENT, bytes(100)).storage()).isEqualTo("ftp");
        }
    }

    @Test
    void theWorkerIsGivenBackAfterAFailedUpload() {
        when(policy.policyFor(Category.OUTAGE)).thenReturn(outageLimits(1, 0));
        s3.failImmediately = true;
        db.failImmediately = true;

        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> upload(Category.OUTAGE, bytes(100))).isInstanceOf(ApiException.class);
        }

        assertThat(bulkheads.running(Category.OUTAGE)).isZero();
    }

    // ------------------------------------------------------------------ recording and reading

    @Test
    void ifTheRowCannotBeRecordedTheBytesAreRemovedAndThereIsNoFallback() {
        doThrow(new IllegalStateException("db down")).when(repo).insert(any(FileRow.class), any(), any());

        assertThatThrownBy(() -> upload(Category.OUTAGE, bytes(100)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));

        assertThat(s3.objects).as("no orphaned object").isEmpty();
        assertThat(db.writeAttempts.get()).as("the fallback needs the database too").isZero();
    }

    @Test
    void readingFromAStorageWithAnOpenCircuitAnswersAtOnce() throws Exception {
        FileReceipt r = upload(Category.OUTAGE, bytes(100));
        int readsBefore = s3.readAttempts.get();
        breakCircuit(Storage.S3);

        assertThatThrownBy(() -> service.openForDownload(UUID.fromString(r.id()), "tester"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));

        assertThat(s3.readAttempts.get()).as("no call to the dead backend").isEqualTo(readsBefore);
    }

    @Test
    void theSpoolNeverHasACircuitSoAParkedFileIsReadableWhileEverythingElseIsDown() throws Exception {
        s3.failImmediately = true;
        byte[] data = bytes(2000);
        FileReceipt r = upload(Category.VIDEO, data);
        breakCircuit(Storage.S3);
        breakCircuit(Storage.DB);

        try (InputStream in = service.openForDownload(UUID.fromString(r.id()), "tester").stream()) {
            assertThat(in.readAllBytes()).isEqualTo(data);
        }
    }

    // ------------------------------------------------------------------ test double

    /** A backend that can be told to refuse, or to die after reading part of the body. */
    private static final class FlakyStorage implements StorageAdapter {
        final Map<String, byte[]> objects = new HashMap<>();
        final AtomicInteger writeAttempts = new AtomicInteger();
        final AtomicInteger readAttempts = new AtomicInteger();
        boolean failImmediately;
        long failAfterBytes = -1;
        private final Storage kind;

        FlakyStorage(Storage kind) {
            this.kind = kind;
        }

        @Override
        public Storage kind() {
            return kind;
        }

        @Override
        public StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception {
            writeAttempts.incrementAndGet();
            if (failImmediately) {
                throw new IOException(kind.slug() + " refused the connection");
            }
            if (failAfterBytes >= 0) {
                body.readNBytes((int) failAfterBytes);
                failAfterBytes = -1; // only the first attempt dies
                throw new IOException(kind.slug() + " connection reset");
            }
            byte[] all = body.readAllBytes();
            objects.put(key, all);
            return new StoredRef(kind, key, all.length);
        }

        @Override
        public InputStream read(String key) throws Exception {
            readAttempts.incrementAndGet();
            byte[] b = objects.get(key);
            return b == null ? null : new ByteArrayInputStream(b);
        }

        @Override
        public void delete(String key) {
            objects.remove(key);
        }

        @Override
        public boolean health() {
            return !failImmediately;
        }
    }
}
