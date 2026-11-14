package ro.ppc.filegrid.observability;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.core.AppenderBase;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.logs.LogRecordBuilder;
import io.opentelemetry.api.logs.Logger;
import io.opentelemetry.api.logs.Severity;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Sends log lines to the OpenTelemetry collector (OTLP), which forwards them to Loki, so Grafana can jump from a
 * trace to the log lines of that same request (contracts/metrics.md). The console output stays as it was.
 *
 * <p>Logback builds its appenders before Spring starts, and the OTLP exporter only exists once Spring has
 * made it. Lines written in between are kept (the newest {@link #EARLY_LIMIT}) and sent once
 * {@link #install} is called. The trace and span id come from the log context (MDC) captured when the line was
 * written, so a line is tied to its request whether it is sent now or a moment later.
 *
 * <p>The category, storage and file id (set by {@link Spans}) go along as attributes. Lines from
 * OpenTelemetry's own packages are skipped: an exporter that cannot connect logs a warning, and sending that
 * warning would fail the same way, forever.
 */
public class OtlpLogAppender extends AppenderBase<ILoggingEvent> {

    static final int EARLY_LIMIT = 500;
    private static final String[] MDC_ATTRIBUTES = {"category", "storage", "file_id"};

    private static final Object LOCK = new Object();
    private static final Deque<ILoggingEvent> EARLY = new ArrayDeque<>();
    private static volatile Logger target;

    /** Called once by Spring when the exporter is ready. Sends what was written before that. */
    public static void install(Logger logger) {
        synchronized (LOCK) {
            target = logger;
            for (ILoggingEvent e : EARLY) {
                send(logger, e);
            }
            EARLY.clear();
        }
    }

    /** For tests: back to the state before Spring started. */
    static void reset() {
        synchronized (LOCK) {
            target = null;
            EARLY.clear();
        }
    }

    @Override
    protected void append(ILoggingEvent event) {
        String name = event.getLoggerName();
        if (name != null && name.startsWith("io.opentelemetry")) {
            return;
        }
        Logger logger = target;
        if (logger != null) {
            send(logger, event);
            return;
        }
        synchronized (LOCK) {
            if (target != null) {
                send(target, event);
                return;
            }
            if (EARLY.size() >= EARLY_LIMIT) {
                EARLY.pollFirst();
            }
            event.prepareForDeferredProcessing(); // the message and MDC must not change under us
            EARLY.addLast(event);
        }
    }

    private static void send(Logger logger, ILoggingEvent event) {
        try {
            Map<String, String> mdc = event.getMDCPropertyMap();
            LogRecordBuilder b = logger.logRecordBuilder()
                    .setTimestamp(Instant.ofEpochMilli(event.getTimeStamp()))
                    .setObservedTimestamp(event.getTimeStamp(), TimeUnit.MILLISECONDS)
                    .setSeverity(severity(event.getLevel()))
                    .setSeverityText(event.getLevel().toString())
                    .setBody(event.getFormattedMessage())
                    .setAttribute(AttributeKey.stringKey("logger"), String.valueOf(event.getLoggerName()))
                    .setAttribute(AttributeKey.stringKey("thread"), String.valueOf(event.getThreadName()));
            for (String key : MDC_ATTRIBUTES) {
                String value = mdc.get(key);
                if (value != null) {
                    b.setAttribute(AttributeKey.stringKey(key), value);
                }
            }
            String traceId = mdc.get("traceId");
            String spanId = mdc.get("spanId");
            if (traceId != null && spanId != null) {
                SpanContext ctx = SpanContext.create(traceId, spanId, TraceFlags.getSampled(), TraceState.getDefault());
                if (ctx.isValid()) {
                    b.setContext(Context.root().with(Span.wrap(ctx)));
                }
            }
            IThrowableProxy t = event.getThrowableProxy();
            if (t != null) {
                b.setAttribute(AttributeKey.stringKey("exception.type"), t.getClassName());
                b.setAttribute(AttributeKey.stringKey("exception.message"), String.valueOf(t.getMessage()));
            }
            b.emit();
        } catch (RuntimeException e) {
            // Losing a log line to the collector must never break the request that wrote it.
        }
    }

    static Severity severity(Level level) {
        return switch (level.toInt()) {
            case Level.ERROR_INT -> Severity.ERROR;
            case Level.WARN_INT -> Severity.WARN;
            case Level.INFO_INT -> Severity.INFO;
            case Level.DEBUG_INT -> Severity.DEBUG;
            default -> Severity.TRACE;
        };
    }
}
