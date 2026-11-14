package ro.ppc.filegrid.observability;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.logs.Severity;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.data.LogRecordData;
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor;
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OtlpLogAppenderTest {

    private static final String TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final String SPAN = "00f067aa0ba902b7";

    private final LoggerContext context = new LoggerContext();
    private OtlpLogAppender appender;
    private InMemoryLogRecordExporter exporter;
    private SdkLoggerProvider provider;

    @BeforeEach
    void setUp() {
        OtlpLogAppender.reset();
        exporter = InMemoryLogRecordExporter.create();
        provider = SdkLoggerProvider.builder().addLogRecordProcessor(SimpleLogRecordProcessor.create(exporter)).build();
        appender = new OtlpLogAppender();
        appender.setContext(context);
        appender.start();
    }

    @AfterEach
    void tearDown() {
        OtlpLogAppender.reset();
        provider.close();
    }

    private LoggingEvent event(String logger, Level level, String message, Map<String, String> mdc) {
        LoggingEvent e = new LoggingEvent(OtlpLogAppenderTest.class.getName(), context.getLogger(logger), level, message, null, null);
        e.setMDCPropertyMap(mdc);
        return e;
    }

    private static String attr(LogRecordData r, String key) {
        return r.getAttributes().get(AttributeKey.stringKey(key));
    }

    @Test
    void aLineBecomesALogRecordWithItsLevelAndMessage() {
        OtlpLogAppender.install(provider.get("t"));

        appender.doAppend(event("ro.ppc.filegrid.files.FileService", Level.WARN, "storage unavailable", Map.of()));

        List<LogRecordData> out = exporter.getFinishedLogRecordItems();
        assertThat(out).hasSize(1);
        assertThat(out.get(0).getBodyValue().asString()).isEqualTo("storage unavailable");
        assertThat(out.get(0).getSeverity()).isEqualTo(Severity.WARN);
        assertThat(out.get(0).getSeverityText()).isEqualTo("WARN");
        assertThat(attr(out.get(0), "logger")).isEqualTo("ro.ppc.filegrid.files.FileService");
    }

    @Test
    void theTraceAndSpanIdsAndTheFileContextTravelWithTheLine() {
        OtlpLogAppender.install(provider.get("t"));

        appender.doAppend(event("x", Level.INFO, "stored", Map.of("traceId", TRACE, "spanId", SPAN, "category", "document",
                "storage", "ftp", "file_id", "6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60", "unrelated", "dropped")));

        LogRecordData r = exporter.getFinishedLogRecordItems().get(0);
        assertThat(r.getSpanContext().getTraceId()).isEqualTo(TRACE);
        assertThat(r.getSpanContext().getSpanId()).isEqualTo(SPAN);
        assertThat(attr(r, "category")).isEqualTo("document");
        assertThat(attr(r, "storage")).isEqualTo("ftp");
        assertThat(attr(r, "file_id")).isEqualTo("6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60");
        assertThat(r.getAttributes().asMap()).as("only the known context keys are sent").doesNotContainKey(AttributeKey.stringKey("unrelated"));
    }

    @Test
    void aLineWithNoTraceIsStillSent() {
        OtlpLogAppender.install(provider.get("t"));

        appender.doAppend(event("x", Level.INFO, "background job", Map.of()));

        LogRecordData r = exporter.getFinishedLogRecordItems().get(0);
        assertThat(r.getSpanContext().isValid()).isFalse();
    }

    @Test
    void linesWrittenBeforeTheExporterExistsAreSentOnceItDoes() {
        appender.doAppend(event("x", Level.INFO, "starting", Map.of()));
        appender.doAppend(event("x", Level.INFO, "flyway done", Map.of("traceId", TRACE, "spanId", SPAN)));
        assertThat(exporter.getFinishedLogRecordItems()).isEmpty();

        OtlpLogAppender.install(provider.get("t"));

        assertThat(exporter.getFinishedLogRecordItems()).extracting(r -> r.getBodyValue().asString())
                .containsExactly("starting", "flyway done");
        assertThat(exporter.getFinishedLogRecordItems().get(1).getSpanContext().getTraceId()).isEqualTo(TRACE);
    }

    @Test
    void onlyTheNewestEarlyLinesAreKeptSoStartupCannotFillTheMemory() {
        for (int i = 0; i < OtlpLogAppender.EARLY_LIMIT + 50; i++) {
            appender.doAppend(event("x", Level.INFO, "line " + i, Map.of()));
        }

        OtlpLogAppender.install(provider.get("t"));

        List<LogRecordData> out = exporter.getFinishedLogRecordItems();
        assertThat(out).hasSize(OtlpLogAppender.EARLY_LIMIT);
        assertThat(out.get(0).getBodyValue().asString()).isEqualTo("line 50");
    }

    @Test
    void openTelemetrysOwnLoggersAreSkippedSoAnUnreachableCollectorCannotLoopOnItself() {
        OtlpLogAppender.install(provider.get("t"));

        appender.doAppend(event("io.opentelemetry.exporter.internal.http.HttpExporter", Level.WARN, "failed to export logs", Map.of()));
        appender.doAppend(event("io.opentelemetry", Level.ERROR, "x", Map.of()));
        appender.doAppend(event("ro.ppc.filegrid.A", Level.INFO, "kept", Map.of()));

        assertThat(exporter.getFinishedLogRecordItems()).extracting(r -> r.getBodyValue().asString()).containsExactly("kept");
    }

    @Test
    void anExceptionIsSentAsTypeAndMessage() {
        OtlpLogAppender.install(provider.get("t"));
        LoggingEvent e = new LoggingEvent(OtlpLogAppenderTest.class.getName(), context.getLogger("x"), Level.ERROR, "failed", new IllegalStateException("db down"), null);
        e.setMDCPropertyMap(Map.of());

        appender.doAppend(e);

        LogRecordData r = exporter.getFinishedLogRecordItems().get(0);
        assertThat(attr(r, "exception.type")).isEqualTo("java.lang.IllegalStateException");
        assertThat(attr(r, "exception.message")).isEqualTo("db down");
        assertThat(r.getSeverity()).isEqualTo(Severity.ERROR);
    }

    @Test
    void theLevelsMapToOpenTelemetrysSeverities() {
        assertThat(OtlpLogAppender.severity(Level.ERROR)).isEqualTo(Severity.ERROR);
        assertThat(OtlpLogAppender.severity(Level.WARN)).isEqualTo(Severity.WARN);
        assertThat(OtlpLogAppender.severity(Level.INFO)).isEqualTo(Severity.INFO);
        assertThat(OtlpLogAppender.severity(Level.DEBUG)).isEqualTo(Severity.DEBUG);
        assertThat(OtlpLogAppender.severity(Level.TRACE)).isEqualTo(Severity.TRACE);
    }
}
