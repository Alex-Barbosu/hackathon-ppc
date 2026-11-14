package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.micrometer.tracing.Tracer;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.audit.AuditLogService;
import ro.ppc.filegrid.common.IntegrityException;
import ro.ppc.filegrid.crypto.EnvelopeCrypto;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * Proves gating requirement 4's failure half: when stored bytes no longer match the recorded
 * SHA-256, download fails with IntegrityException and the integrity-failure counter ticks.
 */
class FileServiceIntegrityTest {

    private final UUID id = UUID.randomUUID();
    private final byte[] original = "the original bytes".getBytes(StandardCharsets.UTF_8);
    private final byte[] tampered = "the TAMPERED bytes".getBytes(StandardCharsets.UTF_8);

    private FileRepository repo;
    private SimpleMeterRegistry registry;
    private FileGridMetrics metrics;
    private FakeStorage storage;
    private FileService service;

    @BeforeEach
    void setUp() {
        repo = mock(FileRepository.class);
        registry = new SimpleMeterRegistry();
        metrics = new FileGridMetrics(registry);
        storage = new FakeStorage();

        PolicyService policy = mock(PolicyService.class);
        // A plain category: no encryption, no audit.
        when(policy.policyFor(any())).thenReturn(
                new CategoryPolicy("s3", "db", false, 20, "high", 8, 500, null, null));
        StorageRegistry storages = mock(StorageRegistry.class);
        when(storages.get(Storage.DB)).thenReturn(storage);
        ReceiptSigner signer = new ReceiptSigner("test-secret");
        Tracer tracer = mock(Tracer.class);
        when(tracer.currentSpan()).thenReturn(null);

        service = new FileService(policy, storages, repo, metrics, signer, tracer,
                new EnvelopeCrypto("ab".repeat(32)), mock(AuditLogService.class), new org.springframework.transaction.support.TransactionTemplate() {
                    @Override
                    public <T> T execute(org.springframework.transaction.support.TransactionCallback<T> action) {
                        return action.doInTransaction(null);
                    }
                });
    }

    private void storedRowWithHashOf(byte[] bytesForHash) {
        String goodHash = sha256Hex(bytesForHash);
        FileRow row = new FileRow(id, "outage", "db", id.toString(), original.length, goodHash,
                "application/octet-stream", null, null, "muntenia", null, "demo", false,
                "stored", null, OffsetDateTime.now(), null);
        when(repo.find(id)).thenReturn(Optional.of(row));
    }

    @Test
    void downloadThrowsAndCountsOnMismatch() {
        // Row records the hash of the ORIGINAL, but storage now holds TAMPERED bytes.
        storedRowWithHashOf(original);
        storage.setBytes(tampered);

        assertThatThrownBy(() -> service.openForDownload(id, "tester"))
                .isInstanceOf(IntegrityException.class);

        double failures = registry.get("filegrid.integrity.failures")
                .tags("category", "outage", "storage", "db").counter().count();
        assertThat(failures).isEqualTo(1.0);
    }

    @Test
    void verifyReportsNotOkOnMismatch() {
        storedRowWithHashOf(original);
        storage.setBytes(tampered);

        var result = service.verify(id, "tester");

        assertThat(result.ok()).isFalse();
        assertThat(result.expected()).isEqualTo(sha256Hex(original));
        assertThat(result.actual()).isEqualTo(sha256Hex(tampered));
    }

    @Test
    void downloadSucceedsWhenBytesMatch() throws Exception {
        storedRowWithHashOf(original);
        storage.setBytes(original);

        var dl = service.openForDownload(id, "tester");
        try (InputStream in = dl.stream()) {
            assertThat(in.readAllBytes()).isEqualTo(original);
        }
        assertThat(dl.sha256()).isEqualTo(sha256Hex(original));
    }

    private static String sha256Hex(byte[] b) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(b));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /** In-memory adapter whose bytes the test can swap to simulate corruption. */
    private static final class FakeStorage implements StorageAdapter {
        private byte[] bytes = new byte[0];

        void setBytes(byte[] b) {
            this.bytes = b;
        }

        @Override
        public Storage kind() {
            return Storage.DB;
        }

        @Override
        public StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception {
            this.bytes = body.readAllBytes();
            return new StoredRef(Storage.DB, key, bytes.length);
        }

        @Override
        public InputStream read(String key) {
            return new ByteArrayInputStream(bytes);
        }

        @Override
        public void delete(String key) {
            bytes = new byte[0];
        }

        @Override
        public boolean health() {
            return true;
        }
    }
}
