package ro.ppc.filegrid.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/**
 * Central Micrometer facade. Micrometer appends {@code _seconds}/{@code _total} to the base
 * names, so {@code filegrid.op.duration} is scraped as {@code filegrid_op_duration_seconds}
 * and {@code filegrid.ops} as {@code filegrid_ops_total} — exactly the names in
 * contracts/metrics.md. Timers carry a percentile histogram so Prometheus can compute
 * p50/p95/p99 server-side.
 */
@Component
public class FileGridMetrics {

    public enum Op { WRITE, READ, VERIFY;
        String tag() { return name().toLowerCase(); }
    }

    public enum Outcome { OK, ERROR, FALLBACK;
        String tag() { return name().toLowerCase(); }
    }

    private final MeterRegistry registry;

    public FileGridMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** Time one storage operation; always record, whatever the outcome. */
    public void recordOp(Category category, Storage storage, Op op, Outcome outcome, Duration took) {
        Timer.builder("filegrid.op.duration")
                .description("Time from request accepted to storage confirmed")
                .tags("category", category.slug(), "storage", storage.slug(),
                        "op", op.tag(), "outcome", outcome.tag())
                .publishPercentileHistogram()
                .register(registry)
                .record(took.toNanos(), TimeUnit.NANOSECONDS);

        Counter.builder("filegrid.ops")
                .description("Operation count by outcome")
                .tags("category", category.slug(), "storage", storage.slug(),
                        "op", op.tag(), "outcome", outcome.tag())
                .register(registry)
                .increment();
    }

    /** Bytes moved in or out of a storage. */
    public void recordBytes(Category category, Storage storage, String direction, long bytes) {
        Counter.builder("filegrid.bytes")
                .tags("category", category.slug(), "storage", storage.slug(), "direction", direction)
                .register(registry)
                .increment(bytes);
    }

    /** Exactly-once proof for meter readings: accepted|duplicate|rejected. */
    public void recordMeterReading(String result) {
        Counter.builder("filegrid.meter.readings")
                .tags("result", result)
                .register(registry)
                .increment();
    }

    /** A tus upload that came back after an interruption (the client asked where to resume). */
    public void recordUploadResume(Category category) {
        Counter.builder("filegrid.upload.resumes")
                .tags("category", category.slug())
                .register(registry)
                .increment();
    }

    /** SHA-256 mismatch detected on read or verify. */
    public void recordIntegrityFailure(Category category, Storage storage) {
        Counter.builder("filegrid.integrity.failures")
                .tags("category", category.slug(), "storage", storage.slug())
                .register(registry)
                .increment();
    }
}
