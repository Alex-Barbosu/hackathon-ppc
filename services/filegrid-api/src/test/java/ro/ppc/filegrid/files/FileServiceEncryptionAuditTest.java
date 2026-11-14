package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.audit.AuditLogService;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.common.IntegrityException;
import ro.ppc.filegrid.crypto.EnvelopeCrypto;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.FileReceipt;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * Proves the document guarantees at the service level: storage only ever holds ciphertext, the
 * receipt hash is of the original bytes, every document access leaves an audit event, and when
 * the audit log is down nothing is released. Postgres is replaced by in-memory stand-ins.
 */
class FileServiceEncryptionAuditTest {

    private static final String MARKER = "PERSONAL-DATA Ion Popescu CNP 0000000000000 ";

    private SimpleMeterRegistry registry;
    private MemoryStorage ftp;
    private MemoryStorage s3;
    private FileRepository repo;
    private AuditLogService audit;
    private FileService service;

    private FileRow savedRow;
    private FileRepository.Crypto savedCrypto;
    private WriteMeta lastWriteMeta;
    private boolean inTransaction;
    private Boolean lastWriteWasInTransaction;
    private MemoryStorage db;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        ftp = new MemoryStorage(Storage.FTP);
        s3 = new MemoryStorage(Storage.S3);
        db = new MemoryStorage(Storage.DB);

        PolicyService policy = mock(PolicyService.class);
        // document: encrypted + audited, on ftp. outage: neither, on s3.
        when(policy.policyFor(Category.DOCUMENT)).thenReturn(
                new CategoryPolicy("ftp", "s3", true, 20, "normal", 4, 200, true, null));
        when(policy.policyFor(Category.OUTAGE)).thenReturn(
                new CategoryPolicy("s3", "db", false, 20, "high", 8, 500, null, null));
        when(policy.primaryStorageFor(Category.DOCUMENT)).thenReturn(Storage.FTP);
        when(policy.primaryStorageFor(Category.OUTAGE)).thenReturn(Storage.S3);
        when(policy.fallbackStorageFor(Category.DOCUMENT)).thenReturn(Storage.S3);
        when(policy.fallbackStorageFor(Category.OUTAGE)).thenReturn(Storage.DB);

        StorageRegistry storages = mock(StorageRegistry.class);
        when(storages.get(Storage.FTP)).thenReturn(ftp);
        when(storages.get(Storage.S3)).thenReturn(s3);
        when(storages.get(Storage.DB)).thenReturn(db);

        repo = mock(FileRepository.class);
        doAnswer(inv -> {
            savedRow = inv.getArgument(0);
            byte[] key = inv.getArgument(1);
            byte[] iv = inv.getArgument(2);
            savedCrypto = key == null ? null : new FileRepository.Crypto(key, iv);
            return null;
        }).when(repo).insert(any(FileRow.class), any(), any());
        when(repo.find(any())).thenAnswer(inv -> Optional.ofNullable(savedRow));
        when(repo.findCrypto(any())).thenAnswer(inv -> Optional.ofNullable(savedCrypto));

        audit = mock(AuditLogService.class);
        Tracer tracer = mock(Tracer.class);
        TransactionTemplate tx = new TransactionTemplate() {
            @Override
            public <T> T execute(TransactionCallback<T> action) {
                inTransaction = true;
                try {
                    return action.doInTransaction(null);
                } finally {
                    inTransaction = false;
                }
            }
        };

        service = new FileService(policy, storages, repo, new FileGridMetrics(registry),
                new ReceiptSigner("test-secret-for-receipts"), tracer, new EnvelopeCrypto("ab".repeat(32)), audit, tx,
                new ro.ppc.filegrid.resilience.StorageGuard(registry, 10, 3, 50f, 10), mock(ro.ppc.filegrid.spool.SpoolRepository.class),
                new ro.ppc.filegrid.resilience.Bulkheads(policy, registry, java.time.Duration.ofSeconds(5)),
                ro.ppc.filegrid.observability.Spans.noop());
    }

    private static byte[] document(int size) {
        byte[] marker = MARKER.getBytes(StandardCharsets.UTF_8);
        byte[] b = new byte[size];
        for (int i = 0; i < size; i++) {
            b[i] = marker[i % marker.length];
        }
        return b;
    }

    private static String sha256(byte[] b) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
    }

    private FileReceipt upload(Category category, byte[] bytes, String user) {
        var req = new FileService.UploadRequest(category, "muntenia", null, "Ion Popescu - contract.pdf",
                "application/pdf", bytes.length, user, null);
        return service.store(req, new ByteArrayInputStream(bytes));
    }

    private static String asText(byte[] b) {
        return new String(b, StandardCharsets.ISO_8859_1);
    }

    // ------------------------------------------------------------------ encryption

    @Test
    void aDocumentIsStoredAsCiphertextWithAReceiptForTheOriginalBytes() throws Exception {
        byte[] plain = document(300_000);

        FileReceipt receipt = upload(Category.DOCUMENT, plain, "connections");

        byte[] stored = ftp.objects.get(receipt.id());
        assertThat(asText(stored)).doesNotContain("PERSONAL-DATA").doesNotContain("Popescu");
        assertThat(stored).hasSize((int) EnvelopeCrypto.ciphertextLength(plain.length));
        assertThat(lastWriteMeta.sizeHint()).as("the backend is told the ciphertext length").isEqualTo(stored.length);
        assertThat(lastWriteMeta.contentType()).as("storage does not learn the file type").isEqualTo("application/octet-stream");

        assertThat(receipt.encrypted()).isTrue();
        assertThat(receipt.sizeBytes()).as("the size of the original").isEqualTo(plain.length);
        assertThat(receipt.sha256()).as("the hash of the original").isEqualTo(sha256(plain));
        assertThat(receipt.storage()).isEqualTo("ftp");

        assertThat(savedRow.encrypted()).isTrue();
        assertThat(savedRow.sizeBytes()).isEqualTo(plain.length);
        assertThat(savedRow.sha256()).isEqualTo(sha256(plain));
        assertThat(savedCrypto.wrappedKey()).hasSize(61);
        assertThat(savedCrypto.iv()).hasSize(7);
    }

    @Test
    void aDocumentComesBackAsTheOriginalBytes() throws Exception {
        byte[] plain = document(300_000);
        FileReceipt receipt = upload(Category.DOCUMENT, plain, "connections");

        var download = service.openForDownload(UUID.fromString(receipt.id()), "alice");

        try (InputStream in = download.stream()) {
            assertThat(in.readAllBytes()).isEqualTo(plain);
        }
        assertThat(download.sha256()).isEqualTo(sha256(plain));
        assertThat(download.sizeBytes()).isEqualTo(plain.length);
    }

    @Test
    void anEmptyDocumentWorks() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, new byte[0], "connections");

        try (InputStream in = service.openForDownload(UUID.fromString(receipt.id()), "alice").stream()) {
            assertThat(in.readAllBytes()).isEmpty();
        }
    }

    @Test
    void aCategoryWithoutEncryptionIsStoredInClearAndStaysReadable() throws Exception {
        byte[] plain = document(10_000);

        FileReceipt receipt = upload(Category.OUTAGE, plain, "dispatch");

        assertThat(s3.objects.get(receipt.id())).isEqualTo(plain);
        assertThat(receipt.encrypted()).isFalse();
        assertThat(savedCrypto).isNull();
        try (InputStream in = service.openForDownload(UUID.fromString(receipt.id()), "dispatch").stream()) {
            assertThat(in.readAllBytes()).isEqualTo(plain);
        }
    }

    @Test
    void alteringTheStoredCiphertextIsRefusedLikeAHashMismatch() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(200_000), "connections");
        ftp.objects.get(receipt.id())[70_000] ^= 1;

        assertThatThrownBy(() -> service.openForDownload(UUID.fromString(receipt.id()), "alice"))
                .isInstanceOf(IntegrityException.class);

        assertThat(registry.get("filegrid.integrity.failures").tags("category", "document", "storage", "ftp")
                .counter().count()).isEqualTo(1.0);
        verify(repo).markCorrupt(UUID.fromString(receipt.id()));
    }

    @Test
    void verifyReportsAlteredCiphertextAsNotOk() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(1000), "connections");
        ftp.objects.get(receipt.id())[10] ^= 1;

        var result = service.verify(UUID.fromString(receipt.id()), "admin");

        assertThat(result.ok()).isFalse();
        assertThat(result.expected()).isEqualTo(receipt.sha256());
        assertThat(result.actual()).isEqualTo("decryption-failed");
    }

    @Test
    void aMissingKeyRowIsAServerErrorNotAnIntegrityFailure() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(1000), "connections");
        savedCrypto = null;

        assertThatThrownBy(() -> service.openForDownload(UUID.fromString(receipt.id()), "alice"))
                .isInstanceOf(IllegalStateException.class);
    }

    // ------------------------------------------------------------------ transactions

    @Test
    void aDatabaseFileIsWrittenInsideTheTransactionThatRecordsIt() throws Exception {
        // stored_blobs has a foreign key to files, so the blob and the row must commit together.
        byte[] plain = document(5000);
        var req = new FileService.UploadRequest(Category.DOCUMENT, null, null, "x.pdf", "application/pdf",
                plain.length, "admin", Storage.DB);

        FileReceipt receipt = service.store(req, new ByteArrayInputStream(plain));

        assertThat(lastWriteWasInTransaction).isTrue();
        assertThat(receipt.storage()).isEqualTo("db");
        assertThat(asText(db.objects.get(receipt.id()))).doesNotContain("PERSONAL-DATA");
        verify(audit).append(eq("admin"), eq("file.write"), eq(UUID.fromString(receipt.id())), any());
    }

    @Test
    void ftpAndS3FilesAreWrittenBeforeTheirRowSoTheTransactionStaysShort() throws Exception {
        upload(Category.DOCUMENT, document(500), "connections");
        assertThat(lastWriteWasInTransaction).isFalse();

        upload(Category.OUTAGE, document(500), "dispatch");
        assertThat(lastWriteWasInTransaction).isFalse();
    }

    // ------------------------------------------------------------------ audit

    @Test
    @SuppressWarnings("unchecked")
    void everyDocumentWriteIsAuditedWithoutThePersonalData() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(2048), "connections");

        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.forClass(Map.class);
        verify(audit).append(eq("connections"), eq("file.write"), eq(UUID.fromString(receipt.id())), details.capture());
        assertThat(details.getValue()).containsEntry("category", "document").containsEntry("storage", "ftp")
                .containsEntry("size", 2048L).containsEntry("sha256", receipt.sha256()).containsEntry("encrypted", true);
        assertThat(details.getValue().toString()).doesNotContain("Popescu").doesNotContain("contract.pdf");
    }

    @Test
    @SuppressWarnings("unchecked")
    void everyDocumentReadIsAuditedBeforeTheBytesAreReleased() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(2048), "connections");
        UUID id = UUID.fromString(receipt.id());
        List<String> order = new ArrayList<>();
        doAnswer(inv -> {
            order.add("audit:" + inv.getArgument(1));
            return null;
        }).when(audit).append(anyString(), eq("file.read"), eq(id), any());

        var download = service.openForDownload(id, "alice");
        order.add("stream returned");

        assertThat(order).containsExactly("audit:file.read", "stream returned");
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.forClass(Map.class);
        verify(audit).append(eq("alice"), eq("file.read"), eq(id), details.capture());
        assertThat(details.getValue()).containsEntry("result", "ok").containsEntry("category", "document");
        download.stream().close();
    }

    @Test
    void aRefusedReadOfATamperedDocumentIsAuditedToo() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(5000), "connections");
        UUID id = UUID.fromString(receipt.id());
        ftp.objects.get(receipt.id())[100] ^= 1;

        assertThatThrownBy(() -> service.openForDownload(id, "mallory")).isInstanceOf(IntegrityException.class);

        verify(audit).append(eq("mallory"), eq("file.read_denied"), eq(id), any());
    }

    @Test
    void verifyMetadataAndLinkAreAuditedForDocuments() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(500), "connections");
        UUID id = UUID.fromString(receipt.id());

        service.verify(id, "admin");
        service.readMetadata(id, "alice");
        service.mintLinkFor(id, "alice");

        verify(audit).append(eq("admin"), eq("file.verify"), eq(id), any());
        verify(audit).append(eq("alice"), eq("file.metadata"), eq(id), any());
        verify(audit).append(eq("alice"), eq("file.download_link"), eq(id), any());
    }

    @Test
    void categoriesWithoutTheAuditFlagWriteNoEvents() throws Exception {
        FileReceipt receipt = upload(Category.OUTAGE, document(500), "dispatch");
        UUID id = UUID.fromString(receipt.id());

        service.openForDownload(id, "dispatch").stream().close();
        service.verify(id, "dispatch");
        service.readMetadata(id, "dispatch");

        verify(audit, never()).append(anyString(), anyString(), any(), any());
    }

    @Test
    void ifTheAuditLogIsDownNoBytesAreReleased() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(500), "connections");
        UUID id = UUID.fromString(receipt.id());
        doThrow(new IllegalStateException("db down")).when(audit).append(anyString(), eq("file.read"), eq(id), any());

        assertThatThrownBy(() -> service.openForDownload(id, "alice"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));
        verify(repo, never()).markVerified(id);
    }

    @Test
    void ifTheAuditEventCannotBeWrittenTheUploadIsRolledBackAndTheBytesRemoved() throws Exception {
        doThrow(new IllegalStateException("db down")).when(audit).append(anyString(), eq("file.write"), any(), any());

        assertThatThrownBy(() -> upload(Category.DOCUMENT, document(500), "connections"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));

        assertThat(ftp.objects).as("no orphaned ciphertext in storage").isEmpty();
    }

    // ------------------------------------------------------------------ test double

    /** A storage backend in memory; it records what it was told about each write. */
    // ------------------------------------------------------------------ delete

    @Test
    void deletingADocumentRemovesTheBytesAndTheRowAndRecordsItInTheSameTransaction() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(1000), "connections");
        UUID id = UUID.fromString(receipt.id());
        boolean[] auditedInTransaction = {false};
        doAnswer(inv -> {
            auditedInTransaction[0] = inTransaction;
            return null;
        }).when(audit).append(eq("admin"), eq("file.delete"), eq(id), any());

        service.delete(id, "admin");

        assertThat(ftp.objects).as("the stored bytes are gone").doesNotContainKey(savedRow.objectKey());
        verify(repo).delete(id);
        verify(audit).append(eq("admin"), eq("file.delete"), eq(id), any());
        assertThat(auditedInTransaction[0]).as("the event commits with the row").isTrue();
    }

    @Test
    void deletingAFileOfACategoryThatIsNotAuditedWritesNoEvent() throws Exception {
        FileReceipt receipt = upload(Category.OUTAGE, document(1000), "field");
        UUID id = UUID.fromString(receipt.id());

        service.delete(id, "admin");

        assertThat(s3.objects).doesNotContainKey(savedRow.objectKey());
        verify(repo).delete(id);
        verify(audit, never()).append(anyString(), eq("file.delete"), any(), any());
    }

    @Test
    void anAuditFailureRefusesTheDelete() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(1000), "connections");
        UUID id = UUID.fromString(receipt.id());
        doThrow(new IllegalStateException("audit down")).when(audit).append(anyString(), eq("file.delete"), any(), any());

        assertThatThrownBy(() -> service.delete(id, "admin")).isInstanceOf(ApiException.class);
    }

    @Test
    void aStorageThatCannotBeReachedKeepsTheRowSoNothingIsOrphaned() throws Exception {
        FileReceipt receipt = upload(Category.DOCUMENT, document(1000), "connections");
        UUID id = UUID.fromString(receipt.id());
        ftp.failDelete = true;

        assertThatThrownBy(() -> service.delete(id, "admin")).isInstanceOf(ApiException.class);

        verify(repo, never()).delete(id);
        verify(audit, never()).append(anyString(), eq("file.delete"), any(), any());
    }

    @Test
    void deletingAnUnknownFileIs404() {
        savedRow = null;
        assertThatThrownBy(() -> service.delete(UUID.randomUUID(), "admin")).isInstanceOf(ApiException.class);
        verify(repo, never()).delete(any());
    }

    private final class MemoryStorage implements StorageAdapter {
        final Map<String, byte[]> objects = new java.util.HashMap<>();
        boolean failDelete;
        private final Storage kind;

        MemoryStorage(Storage kind) {
            this.kind = kind;
        }

        @Override
        public Storage kind() {
            return kind;
        }

        @Override
        public StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception {
            lastWriteMeta = meta;
            lastWriteWasInTransaction = inTransaction;
            byte[] bytes = body.readAllBytes();
            objects.put(key, bytes);
            return new StoredRef(kind, key, bytes.length);
        }

        @Override
        public InputStream read(String key) {
            byte[] b = objects.get(key);
            return b == null ? null : new ByteArrayInputStream(b);
        }

        @Override
        public void delete(String key) throws java.io.IOException {
            if (failDelete) {
                throw new java.io.IOException("storage unreachable");
            }
            objects.remove(key);
        }

        @Override
        public boolean health() {
            return true;
        }
    }
}
