package ro.ppc.filegrid.meters;

import jakarta.validation.Valid;
import java.time.Duration;
import java.time.OffsetDateTime;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.meters.dto.MeterAck;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;

/**
 * POST /api/v1/meter-readings. 201 {result: accepted} the first time, 200 {result: duplicate}
 * on a retry with the same key. The metric is counted AFTER the transaction commits, so the
 * accepted count can never exceed the rows actually stored.
 */
@RestController
@RequestMapping("/api/v1/meter-readings")
public class MeterController {

    private final MeterService service;
    private final FileGridMetrics metrics;
    private final io.micrometer.tracing.Tracer tracer;

    public MeterController(MeterService service, FileGridMetrics metrics,
                           io.micrometer.tracing.Tracer tracer) {
        this.service = service;
        this.metrics = metrics;
        this.tracer = tracer;
    }

    @PostMapping
    public ResponseEntity<MeterAck> ingest(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody MeterReadingFile body) {

        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw ApiException.badRequest("Idempotency-Key header is required");
        }

        var span = tracer.currentSpan();
        String traceId = span == null ? null : span.context().traceId();

        long started = System.nanoTime();
        MeterService.Ingested ingested;
        try {
            ingested = service.ingest(idempotencyKey, body, traceId);
        } catch (RuntimeException e) {
            // Neither the database nor the spool took it; the meter retries with the same key.
            metrics.recordOp(Category.METER, Storage.DB, FileGridMetrics.Op.WRITE,
                    FileGridMetrics.Outcome.ERROR, Duration.ofNanos(System.nanoTime() - started));
            throw e;
        }
        // A parked reading is a fallback write: it landed in the spool, not in the database.
        metrics.recordOp(Category.METER, ingested.spooled() ? Storage.SPOOL : Storage.DB, FileGridMetrics.Op.WRITE,
                ingested.spooled() ? FileGridMetrics.Outcome.FALLBACK : FileGridMetrics.Outcome.OK,
                Duration.ofNanos(System.nanoTime() - started));

        // Counted only once the reading is committed or durably parked.
        if (ingested.result() == MeterService.Result.ACCEPTED) {
            metrics.recordMeterReading("accepted");
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(new MeterAck("accepted", idempotencyKey, OffsetDateTime.now()));
        }
        metrics.recordMeterReading("duplicate");
        return ResponseEntity.ok(new MeterAck("duplicate", idempotencyKey, null));
    }
}
