package ro.ppc.filegrid.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.tracing.test.simple.SimpleSpan;
import io.micrometer.tracing.test.simple.SimpleTracer;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

class SpansTest {

    private SimpleTracer tracer;
    private Spans spans;
    private final UUID id = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        tracer = new SimpleTracer();
        spans = new Spans(tracer);
        MDC.clear();
    }

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    private SimpleSpan only() {
        assertThat(tracer.getSpans()).hasSize(1);
        return tracer.getSpans().peek();
    }

    @Test
    void aLogContextSetsTheKeysAndPutsThemBack() {
        MDC.put("storage", "db");
        try (Spans.Context c = Spans.context(Category.OUTAGE, Storage.S3, id)) {
            assertThat(MDC.get("category")).isEqualTo("outage");
            assertThat(MDC.get("storage")).isEqualTo("s3");
            assertThat(MDC.get("file_id")).isEqualTo(id.toString());
        }
        assertThat(MDC.get("category")).isNull();
        assertThat(MDC.get("file_id")).isNull();
        assertThat(MDC.get("storage")).isEqualTo("db");
    }

    @Test
    void aLogContextLeavesNullKeysAlone() {
        MDC.put("category", "outage");
        try (Spans.Context c = Spans.context(null, Storage.DB, null)) {
            assertThat(MDC.get("category")).isEqualTo("outage");
            assertThat(MDC.get("storage")).isEqualTo("db");
        }
        assertThat(MDC.get("storage")).isNull();
        assertThat(MDC.get("category")).isEqualTo("outage");
    }

    @Test
    void aSpanHasTheContractsNameAndAttributes() {
        try (Spans.Scope s = spans.open("storage.write", Category.OUTAGE, Storage.S3, id, 2048L)) {
            // work
        }

        SimpleSpan span = only();
        assertThat(span.getName()).isEqualTo("storage.write");
        assertThat(span.getTags()).containsEntry("filegrid.category", "outage").containsEntry("filegrid.storage", "s3")
                .containsEntry("filegrid.file_id", id.toString()).containsEntry("filegrid.size_bytes", "2048");
        assertThat(span.getStartTimestamp()).as("started").isNotEqualTo(java.time.Instant.EPOCH);
        assertThat(span.getEndTimestamp()).as("ended").isNotEqualTo(java.time.Instant.EPOCH);
    }

    @Test
    void attributesThatAreNotKnownYetAreLeftOut() {
        try (Spans.Scope s = spans.open("policy.route", Category.VIDEO, null, null, null)) {
            s.tag("filegrid.storage", "s3");
        }

        assertThat(only().getTags()).containsOnlyKeys("filegrid.category", "filegrid.storage").containsEntry("filegrid.storage", "s3");
    }

    @Test
    void whileASpanIsOpenLogLinesCarryCategoryStorageAndFileIdAndAfterwardsTheyDoNot() {
        try (Spans.Scope s = spans.open("storage.write", Category.DOCUMENT, Storage.FTP, id, 10L)) {
            assertThat(MDC.get("category")).isEqualTo("document");
            assertThat(MDC.get("storage")).isEqualTo("ftp");
            assertThat(MDC.get("file_id")).isEqualTo(id.toString());
        }

        assertThat(MDC.get("category")).isNull();
        assertThat(MDC.get("storage")).isNull();
        assertThat(MDC.get("file_id")).isNull();
    }

    @Test
    void aStorageSetLaterAppearsInTheLogContextToo() {
        try (Spans.Scope s = spans.open("policy.route", Category.OUTAGE, null, id, 1L)) {
            assertThat(MDC.get("storage")).isNull();
            s.tag("filegrid.storage", "db");
            assertThat(MDC.get("storage")).isEqualTo("db");
        }
        assertThat(MDC.get("storage")).isNull();
    }

    @Test
    void anInnerSpanRestoresTheOuterOnesLogContext() {
        try (Spans.Scope outer = spans.open("integrity.verify", Category.OUTAGE, Storage.S3, id, 1L)) {
            try (Spans.Scope inner = spans.open("storage.read", Category.OUTAGE, Storage.DB, id, 1L)) {
                assertThat(MDC.get("storage")).isEqualTo("db");
            }
            assertThat(MDC.get("storage")).as("back to the outer span's").isEqualTo("s3");
        }
        assertThat(MDC.get("storage")).isNull();
    }

    @Test
    void aFailureIsRecordedOnTheSpan() {
        IllegalStateException boom = new IllegalStateException("s3 refused the connection");

        try (Spans.Scope s = spans.open("storage.write", Category.OUTAGE, Storage.S3, id, 1L)) {
            s.error(boom);
        }

        assertThat(only().getError()).isSameAs(boom);
    }

    @Test
    void aSpanOpenedInsideAnotherIsItsChildSoTheRequestReadsAsATree() {
        SimpleSpan parent = tracer.nextSpan().name("http post /api/v1/files").start();
        try (var ignored = tracer.withSpan(parent)) {
            try (Spans.Scope s = spans.open("policy.route", Category.OUTAGE, Storage.S3, id, 1L)) {
                // decision
            }
            try (Spans.Scope s = spans.open("storage.write", Category.OUTAGE, Storage.S3, id, 1L)) {
                // write
            }
        }
        parent.end();

        var children = tracer.getSpans().stream().filter(sp -> sp != parent).toList();
        assertThat(children).extracting(SimpleSpan::getName).containsExactly("policy.route", "storage.write");
        assertThat(children).allSatisfy(c -> assertThat(c.context().parentId()).isEqualTo(parent.context().spanId()));
        assertThat(children).allSatisfy(c -> assertThat(c.context().traceId()).isEqualTo(parent.context().traceId()));
    }

    @Test
    void aSpanThatOutlivesTheMethodEndsWhenItsStreamIsClosedAndCountsTheBytes() throws Exception {
        Spans.Scope delivery = spans.start("storage.read", Category.VIDEO, Storage.S3, id, 6L);
        InputStream in = spans.endOnClose(delivery, new ByteArrayInputStream("abcdef".getBytes()));

        assertThat(only().getEndTimestamp()).as("still open while the client is downloading").isEqualTo(java.time.Instant.EPOCH);
        in.readAllBytes();
        in.close();

        SimpleSpan span = only();
        assertThat(span.getEndTimestamp()).as("ended on close").isNotEqualTo(java.time.Instant.EPOCH);
        assertThat(span.getTags()).containsEntry("filegrid.bytes_read", "6");
        assertThat(MDC.get("storage")).as("it never touched the log context").isNull();
    }

    @Test
    void aReadFailureWhileStreamingIsRecorded() throws Exception {
        Spans.Scope delivery = spans.start("storage.read", Category.VIDEO, Storage.S3, id, 6L);
        InputStream failing = new InputStream() {
            @Override
            public int read() throws IOException {
                throw new IOException("connection reset");
            }
        };
        InputStream in = spans.endOnClose(delivery, failing);

        try {
            in.read();
        } catch (IOException expected) {
            // the client or storage went away
        }
        in.close();

        assertThat(only().getError()).hasMessage("connection reset");
    }

    @Test
    void closingTwiceEndsOnce() {
        Spans.Scope s = spans.open("storage.write", Category.OUTAGE, Storage.S3, id, 1L);
        s.close();
        s.close();

        assertThat(tracer.getSpans()).hasSize(1);
    }

    @Test
    void withoutATracerEverythingStillWorks() throws Exception {
        Spans none = Spans.noop();

        try (Spans.Scope s = none.open("storage.write", Category.OUTAGE, Storage.S3, id, 1L)) {
            s.tag("filegrid.storage", "s3").tag("x", 1).tag("y", true);
            s.error(new RuntimeException("ignored"));
        }
        InputStream in = none.endOnClose(none.start("storage.read", Category.OUTAGE, Storage.S3, id, 1L),
                new ByteArrayInputStream(new byte[] {1}));

        assertThat(in.readAllBytes()).hasSize(1);
        assertThat(MDC.get("category")).isNull();
    }
}
