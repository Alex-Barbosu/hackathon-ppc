package ro.ppc.filegrid.observability;

import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/**
 * The spans of contracts/metrics.md: {@code policy.route}, {@code storage.write}, {@code storage.read} and
 * {@code integrity.verify}, with the attributes {@code filegrid.category}, {@code filegrid.storage},
 * {@code filegrid.file_id} and {@code filegrid.size_bytes}. They hang under the request's own span
 * ({@code http <method> <route>}), so one upload reads as a tree: the request, where the policy sent
 * it, each write (a failed primary and the fallback show up as two), and the check.
 *
 * <p>While a span is open, the category, storage and file id are also put in the log context (MDC), so
 * every log line written inside it carries them next to the trace id. A span never holds a file name or
 * any content: only the file id.
 *
 * <p>{@link #noop()} is for code that runs without a tracer (unit tests).
 */
@Component
public class Spans {

    private static final String[] MDC_KEYS = {"category", "storage", "file_id"};

    private final Tracer tracer;

    @Autowired
    public Spans(Tracer tracer) {
        this.tracer = tracer;
    }

    public static Spans noop() {
        return new Spans(null);
    }

    /**
     * Puts category, storage and file id in the log context for a block of code that is not inside a span,
     * such as the "stored" line written after a write span has ended. A null value leaves that key as it is.
     * Works without a tracer.
     */
    public static Context context(Category category, Storage storage, UUID fileId) {
        String[] before = new String[MDC_KEYS.length];
        String[] now = {category == null ? null : category.slug(), storage == null ? null : storage.slug(),
                fileId == null ? null : fileId.toString()};
        for (int i = 0; i < MDC_KEYS.length; i++) {
            before[i] = MDC.get(MDC_KEYS[i]);
            if (now[i] != null) {
                MDC.put(MDC_KEYS[i], now[i]);
            }
        }
        return new Context(before);
    }

    /** A log context set by {@link #context}. Closing it puts the log context back as it was. */
    public static final class Context implements AutoCloseable {
        private final String[] before;

        private Context(String[] before) {
            this.before = before;
        }

        @Override
        public void close() {
            for (int i = 0; i < MDC_KEYS.length; i++) {
                if (before[i] == null) {
                    MDC.remove(MDC_KEYS[i]);
                } else {
                    MDC.put(MDC_KEYS[i], before[i]);
                }
            }
        }
    }

    /**
     * Starts a child of the current span and makes it current until the returned scope is closed. Pass null
     * for an attribute that is not known yet; set it later with {@link Scope#tag}.
     */
    public Scope open(String name, Category category, Storage storage, UUID fileId, Long sizeBytes) {
        return begin(name, category, storage, fileId, sizeBytes, true);
    }

    /**
     * Starts a child span but does not make it current: for work that outlives the calling method, such as
     * streaming a download. Close the scope (or the stream from {@link #endOnClose}) to end it.
     */
    public Scope start(String name, Category category, Storage storage, UUID fileId, Long sizeBytes) {
        return begin(name, category, storage, fileId, sizeBytes, false);
    }

    /** Ends {@code scope} when {@code in} is closed, and records how many bytes were read and any read error. */
    public InputStream endOnClose(Scope scope, InputStream in) {
        return scope.isNoop() ? in : new EndingInputStream(in, scope);
    }

    private Scope begin(String name, Category category, Storage storage, UUID fileId, Long sizeBytes, boolean current) {
        if (tracer == null) {
            return Scope.NOOP;
        }
        Span span = tracer.nextSpan().name(name);
        if (category != null) {
            span.tag("filegrid.category", category.slug());
        }
        if (storage != null) {
            span.tag("filegrid.storage", storage.slug());
        }
        if (fileId != null) {
            span.tag("filegrid.file_id", fileId.toString());
        }
        if (sizeBytes != null) {
            span.tag("filegrid.size_bytes", sizeBytes);
        }
        span.start();
        if (!current) {
            return new Scope(span, null, null);
        }
        String[] before = new String[MDC_KEYS.length];
        String[] now = {category == null ? null : category.slug(), storage == null ? null : storage.slug(),
                fileId == null ? null : fileId.toString()};
        for (int i = 0; i < MDC_KEYS.length; i++) {
            before[i] = MDC.get(MDC_KEYS[i]);
            if (now[i] != null) {
                MDC.put(MDC_KEYS[i], now[i]);
            }
        }
        return new Scope(span, tracer.withSpan(span), before);
    }

    /** An open span. Closing it ends the span and puts the log context back as it was. */
    public static final class Scope implements AutoCloseable {

        static final Scope NOOP = new Scope(null, null, null);

        private final Span span;
        private final Tracer.SpanInScope inScope;
        private final String[] mdcBefore;
        private boolean closed;

        private Scope(Span span, Tracer.SpanInScope inScope, String[] mdcBefore) {
            this.span = span;
            this.inScope = inScope;
            this.mdcBefore = mdcBefore;
        }

        boolean isNoop() {
            return span == null;
        }

        public Scope tag(String key, String value) {
            if (span != null && value != null) {
                span.tag(key, value);
                mirror(key, value);
            }
            return this;
        }

        public Scope tag(String key, long value) {
            if (span != null) {
                span.tag(key, value);
            }
            return this;
        }

        public Scope tag(String key, boolean value) {
            if (span != null) {
                span.tag(key, value);
            }
            return this;
        }

        /** Sets the storage or file id once it is known, in the span and in the log context. */
        private void mirror(String key, String value) {
            if (mdcBefore == null) {
                return;
            }
            switch (key) {
                case "filegrid.storage" -> MDC.put("storage", value);
                case "filegrid.file_id" -> MDC.put("file_id", value);
                case "filegrid.category" -> MDC.put("category", value);
                default -> { }
            }
        }

        /** Marks the span as failed. The exception message goes in the span, so it must not hold personal data. */
        public void error(Throwable t) {
            if (span != null) {
                span.error(t);
            }
        }

        @Override
        public void close() {
            if (span == null || closed) {
                return;
            }
            closed = true;
            if (inScope != null) {
                inScope.close();
            }
            if (mdcBefore != null) {
                for (int i = 0; i < MDC_KEYS.length; i++) {
                    if (mdcBefore[i] == null) {
                        MDC.remove(MDC_KEYS[i]);
                    } else {
                        MDC.put(MDC_KEYS[i], mdcBefore[i]);
                    }
                }
            }
            span.end();
        }
    }

    private static final class EndingInputStream extends FilterInputStream {
        private final Scope scope;
        private long bytes;

        EndingInputStream(InputStream in, Scope scope) {
            super(in);
            this.scope = scope;
        }

        @Override
        public int read() throws IOException {
            try {
                int b = super.read();
                if (b >= 0) {
                    bytes++;
                }
                return b;
            } catch (IOException e) {
                scope.error(e);
                throw e;
            }
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            try {
                int n = super.read(b, off, len);
                if (n > 0) {
                    bytes += n;
                }
                return n;
            } catch (IOException e) {
                scope.error(e);
                throw e;
            }
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                scope.tag("filegrid.bytes_read", bytes);
                scope.close();
            }
        }
    }
}
