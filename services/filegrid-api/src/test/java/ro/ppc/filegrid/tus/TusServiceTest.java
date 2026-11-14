package ro.ppc.filegrid.tus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import io.micrometer.tracing.Tracer;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;

/**
 * Drives the real upload logic against in-memory stand-ins for Postgres and S3. The fake S3
 * rejects any non-last part under 5 MB, as the real one does, so a green test means the part
 * layout would be accepted, and the assertions compare the stored bytes and the SHA-256.
 */
class TusServiceTest {

    private static final int MB = 1024 * 1024;
    private static final String BUCKET = "filegrid-video";

    private FakeTusStore store;
    private FakeObjectStore objects;
    private PolicyService policy;
    private SimpleMeterRegistry registry;
    private TusService tus;

    @BeforeEach
    void setUp() {
        store = new FakeTusStore();
        objects = new FakeObjectStore();
        policy = mock(PolicyService.class);
        // chunkMb 5 is the schema minimum, which keeps these tests quick.
        when(policy.policyFor(Category.VIDEO)).thenReturn(
                new CategoryPolicy("s3", "spool", false, 5000, "low", 2, 20, null, 5));
        when(policy.policyFor(Category.DOCUMENT)).thenReturn(
                new CategoryPolicy("ftp", "s3", true, 20, "normal", 4, 200, true, null));
        registry = new SimpleMeterRegistry();
        tus = newService();
    }

    private TusService newService() {
        Tracer tracer = mock(Tracer.class);
        return new TusService(policy, store, objects, new FileGridMetrics(registry), tracer,
                new ro.ppc.filegrid.resilience.Bulkheads(policy, registry, java.time.Duration.ofSeconds(5)));
    }

    private static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        new Random(42).nextBytes(b);
        return b;
    }

    private static String sha256(byte[] b) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
    }

    private UUID createVideo(long length) {
        return tus.create(length, Map.of("category", "video", "filename", "a.mp4", "filetype", "video/mp4",
                "region", "banat"), "field");
    }

    private TusService.PatchResult send(TusService service, UUID id, long offset, byte[] data, int from, int to) {
        return service.append(id, offset, to - from, new ByteArrayInputStream(data, from, to - from));
    }

    private void assertStoredExactly(UUID id, byte[] data) throws Exception {
        assertThat(objects.objects.get(BUCKET + "/" + id)).isEqualTo(data);
        var row = store.files.get(id);
        assertThat(row.sha256()).isEqualTo(sha256(data));
        assertThat(row.sizeBytes()).isEqualTo(data.length);
        assertThat(row.storage()).isEqualTo("s3");
        assertThat(row.objectKey()).isEqualTo(BUCKET + "/" + id);
        assertThat(row.category()).isEqualTo("video");
    }

    // ------------------------------------------------------------------ happy paths

    @Test
    void oneChunkStoresTheFileAndHashesItWhileStreaming() throws Exception {
        byte[] data = randomBytes(13 * MB + 123);
        UUID id = createVideo(data.length);

        var result = send(tus, id, 0, data, 0, data.length);

        assertThat(result.fileId()).isEqualTo(id);
        assertThat(result.offset()).isEqualTo(data.length);
        assertStoredExactly(id, data);
        assertThat(objects.partSizes).containsExactly(5 * MB, 5 * MB, 3 * MB + 123);
        assertThat(objects.opens).as("the hash came from the stream, not a read-back").isZero();
        assertThat(objects.tails).isEmpty();
    }

    @Test
    void awkwardChunkSizesStillProduceTheExactFile() throws Exception {
        byte[] data = randomBytes(13 * MB + 123);
        UUID id = createVideo(data.length);
        int chunk = 4_000_001;

        long offset = 0;
        TusService.PatchResult r = null;
        while (offset < data.length) {
            int to = (int) Math.min(data.length, offset + chunk);
            r = send(tus, id, offset, data, (int) offset, to);
            assertThat(r.offset()).isEqualTo(to);
            if (to < data.length) {
                assertThat(r.fileId()).isNull();
                // Bytes that have not filled a part are already durable.
                assertThat(store.find(id).orElseThrow().offset()).isEqualTo(to);
            }
            offset = r.offset();
        }

        assertThat(r.fileId()).isEqualTo(id);
        assertStoredExactly(id, data);
        assertThat(objects.opens).isZero();
        assertThat(objects.tails).as("the leftover object is removed at the end").isEmpty();
    }

    @Test
    void aSizeThatIsExactlyWholePartsNeedsNoLeftover() throws Exception {
        byte[] data = randomBytes(10 * MB);
        UUID id = createVideo(data.length);

        var r = send(tus, id, 0, data, 0, data.length);

        assertThat(r.fileId()).isEqualTo(id);
        assertThat(objects.partSizes).containsExactly(5 * MB, 5 * MB);
        assertStoredExactly(id, data);
    }

    @Test
    void aFileSmallerThanOnePartIsOneShortPart() throws Exception {
        byte[] data = randomBytes(1000);
        UUID id = createVideo(data.length);

        send(tus, id, 0, data, 0, data.length);

        assertThat(objects.partSizes).containsExactly(1000);
        assertStoredExactly(id, data);
    }

    // ------------------------------------------------------------------ resuming

    /** Delivers {@code okBytes} and then fails, like a connection that drops mid-chunk. */
    private static InputStream dropsAfter(byte[] data, int from, int okBytes) {
        InputStream in = new ByteArrayInputStream(data, from, okBytes);
        return new InputStream() {
            int sent;

            @Override
            public int read() throws IOException {
                byte[] one = new byte[1];
                return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
            }

            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                int n = in.read(b, off, len);
                if (n < 0) {
                    throw new IOException("connection reset");
                }
                sent += n;
                return n;
            }
        };
    }

    @Test
    void aDroppedConnectionKeepsWhatArrivedAndResumesFromThere() throws Exception {
        byte[] data = randomBytes(13 * MB + 123);
        UUID id = createVideo(data.length);

        // The link dies after 7,000,000 bytes: one whole part plus a leftover.
        tus.append(id, 0, data.length, dropsAfter(data, 0, 7_000_000));

        TusUpload up = tus.head(id);
        assertThat(up.offset()).as("everything received is counted").isEqualTo(7_000_000);
        assertThat(objects.tails.get(id.toString())).hasSize(7_000_000 - 5 * MB);
        assertThat(registry.get("filegrid.upload.resumes").tag("category", "video").counter().count())
                .as("the HEAD after a drop is a resume").isEqualTo(1.0);

        var r = send(tus, id, up.offset(), data, (int) up.offset(), data.length);

        assertThat(r.fileId()).isEqualTo(id);
        assertStoredExactly(id, data);
        assertThat(objects.opens).as("same instance, so still hashed while streaming").isZero();
    }

    @Test
    void anotherReplicaCanTakeOverAndTheHashIsStillRight() throws Exception {
        byte[] data = randomBytes(13 * MB + 123);
        UUID id = createVideo(data.length);
        send(tus, id, 0, data, 0, 6 * MB);

        // A second instance shares the database and S3 but has no running digest.
        TusService other = newService();
        var r = send(other, id, 6 * MB, data, 6 * MB, data.length);

        assertThat(r.fileId()).isEqualTo(id);
        assertStoredExactly(id, data);
        assertThat(objects.opens).as("hashed once by reading the stored object back").isEqualTo(1);
    }

    @Test
    void aLostLeftoverFallsBackToTheLastWholePart() throws Exception {
        byte[] data = randomBytes(12 * MB);
        UUID id = createVideo(data.length);
        send(tus, id, 0, data, 0, 7 * MB);
        objects.tails.clear(); // the leftover object vanished

        assertThatThrownBy(() -> send(tus, id, 7 * MB, data, 7 * MB, data.length))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(409));
        assertThat(store.find(id).orElseThrow().offset()).as("reset to the last whole part").isEqualTo(5 * MB);

        var r = send(tus, id, 5 * MB, data, 5 * MB, data.length);
        assertThat(r.fileId()).isEqualTo(id);
        assertStoredExactly(id, data);
    }

    @Test
    void aStorageFailureDoesNotAdvanceTheOffsetAndTheClientCanRetry() throws Exception {
        byte[] data = randomBytes(8 * MB);
        UUID id = createVideo(data.length);
        objects.failParts = true;

        assertThatThrownBy(() -> send(tus, id, 0, data, 0, data.length))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));
        assertThat(store.find(id).orElseThrow().offset()).isZero();

        objects.failParts = false;
        var r = send(tus, id, 0, data, 0, data.length);
        assertThat(r.fileId()).isEqualTo(id);
        assertStoredExactly(id, data);
    }

    // ------------------------------------------------------------------ bulkheads

    @Test
    void aChunkIsRefusedWhenTheCategoryHasNoFreeWorkerAndTheUploadIsUntouched() throws Exception {
        byte[] data = randomBytes(8 * MB);
        UUID id = createVideo(data.length);
        when(policy.policyFor(Category.VIDEO)).thenReturn(
                new CategoryPolicy("s3", "spool", false, 5000, "low", 1, 0, null, 5));
        var bulkheads = new ro.ppc.filegrid.resilience.Bulkheads(policy, registry, java.time.Duration.ofSeconds(5));
        TusService limited = new TusService(policy, store, objects, new FileGridMetrics(registry), mock(Tracer.class), bulkheads);

        try (var held = bulkheads.enter(Category.VIDEO)) {
            assertThatThrownBy(() -> send(limited, id, 0, data, 0, 1000))
                    .isInstanceOf(ro.ppc.filegrid.resilience.BulkheadFullException.class);
        }

        assertThat(store.find(id).orElseThrow().offset()).as("nothing was consumed").isZero();
        assertThat(objects.pending).isEmpty();
        // The client retries the same chunk and now gets through.
        assertThat(send(limited, id, 0, data, 0, data.length).fileId()).isEqualTo(id);
    }

    @Test
    void aChunkThatFailsStillGivesItsWorkerBack() {
        byte[] data = randomBytes(8 * MB);
        UUID id = createVideo(data.length);
        when(policy.policyFor(Category.VIDEO)).thenReturn(
                new CategoryPolicy("s3", "spool", false, 5000, "low", 1, 0, null, 5));
        var bulkheads = new ro.ppc.filegrid.resilience.Bulkheads(policy, registry, java.time.Duration.ofSeconds(5));
        TusService limited = new TusService(policy, store, objects, new FileGridMetrics(registry), mock(Tracer.class), bulkheads);
        objects.failParts = true;

        for (int i = 0; i < 3; i++) {
            assertThatThrownBy(() -> send(limited, id, 0, data, 0, data.length)).isInstanceOf(ApiException.class);
        }

        assertThat(bulkheads.running(Category.VIDEO)).isZero();
    }

    // ------------------------------------------------------------------ protocol rules

    @Test
    void aWrongOffsetIsAConflict() {
        byte[] data = randomBytes(6 * MB);
        UUID id = createVideo(data.length);

        assertThatThrownBy(() -> send(tus, id, 1, data, 0, 1000))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(409));
    }

    @Test
    void aBodyLargerThanTheDeclaredLengthIsRefused() {
        byte[] data = randomBytes(1000);
        UUID id = createVideo(500);

        assertThatThrownBy(() -> send(tus, id, 0, data, 0, 1000))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(413));
    }

    @Test
    void anUnknownUploadIs404() {
        assertThatThrownBy(() -> tus.head(UUID.randomUUID()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(404));
    }

    @Test
    void afterTheLastChunkAResendIsAnswered() throws Exception {
        byte[] data = randomBytes(6 * MB);
        UUID id = createVideo(data.length);
        send(tus, id, 0, data, 0, data.length);

        var again = tus.append(id, data.length, 0, new ByteArrayInputStream(new byte[0]));
        assertThat(again.fileId()).isEqualTo(id);

        assertThatThrownBy(() -> send(tus, id, 0, data, 0, 10))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(409));
    }

    // ------------------------------------------------------------------ creation rules

    @Test
    void onlyCategoriesStoredInS3CanUseTus() {
        assertThatThrownBy(() -> tus.create(1000, Map.of("category", "document"), "connections"))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.status().value()).isEqualTo(400);
                    assertThat(e.getMessage()).contains("POST /api/v1/files");
                });
    }

    @Test
    void aCategoryThatNeedsEncryptionOrAuditCannotUseTusYet() {
        // Accepting it would store the bytes in clear and unaudited, against the policy.
        when(policy.policyFor(Category.OUTAGE)).thenReturn(
                new CategoryPolicy("s3", "db", true, 20, "high", 8, 500, null, null));
        when(policy.policyFor(Category.METER)).thenReturn(
                new CategoryPolicy("s3", "db", false, 20, "high", 8, 500, true, null));

        for (String category : new String[] {"outage", "meter"}) {
            assertThatThrownBy(() -> tus.create(1000, Map.of("category", category), "u"))
                    .isInstanceOfSatisfying(ApiException.class, e -> {
                        assertThat(e.status().value()).isEqualTo(400);
                        assertThat(e.getMessage()).contains("encryption or auditing");
                    });
        }
    }

    @Test
    void creationRejectsBadInput() {
        assertThatThrownBy(() -> tus.create(1000, Map.of(), "u")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> tus.create(1000, Map.of("category", "nope"), "u")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> tus.create(0, Map.of("category", "video"), "u")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> tus.create(1000, Map.of("category", "video", "region", "mars"), "u"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> tus.create(5001L * MB, Map.of("category", "video"), "u"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(413));
    }

    @Test
    void creationRecordsWhoUploadedAndWhere() {
        UUID id = createVideo(1000);

        TusUpload up = store.find(id).orElseThrow();
        assertThat(up.uploadedBy()).isEqualTo("field");
        assertThat(up.bucket()).isEqualTo(BUCKET);
        assertThat(up.objectKey()).isEqualTo(id.toString());
        assertThat(up.partSize()).isEqualTo(5 * MB);
        assertThat(up.region()).isEqualTo("banat");
        assertThat(up.contentType()).isEqualTo("video/mp4");
    }

    // ------------------------------------------------------------------ cleanup

    @Test
    void idleUploadsAreAbortedSoS3KeepsNoOrphanParts() {
        UUID id = createVideo(8 * MB);
        send(tus, id, 0, randomBytes(8 * MB), 0, 1000);

        tus.cleanup();

        assertThat(store.uploads).isEmpty();
        assertThat(objects.aborted).contains(id.toString());
        assertThat(objects.tails).isEmpty();
    }

    @Test
    void metricsCountTheFinishedUploadOnce() {
        byte[] data = randomBytes(6 * MB);
        UUID id = createVideo(data.length);
        send(tus, id, 0, data, 0, 3 * MB);
        send(tus, id, 3 * MB, data, 3 * MB, data.length);

        assertThat(registry.get("filegrid.ops").tags("category", "video", "storage", "s3", "op", "write",
                "outcome", "ok").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("filegrid.bytes").tags("category", "video", "storage", "s3", "direction", "in")
                .counter().count()).isEqualTo((double) data.length);
    }

    @Test
    void hashOfDifferentDataDiffers() throws Exception {
        // Guards the helper: two uploads with different bytes must not share a hash.
        byte[] a = randomBytes(1000);
        byte[] b = Arrays.copyOf(a, a.length);
        b[500] ^= 1;
        assertThat(sha256(a)).isNotEqualTo(sha256(b));
    }
}
