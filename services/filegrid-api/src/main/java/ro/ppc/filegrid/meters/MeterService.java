package ro.ppc.filegrid.meters;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;
import ro.ppc.filegrid.resilience.Bulkheads;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.resilience.StorageDownException;
import ro.ppc.filegrid.resilience.StorageGuard;

/**
 * Idempotent meter-reading ingest. The database unique constraint is the source of truth; this
 * service only decides accepted vs duplicate from whether the insert created a row. The insert
 * runs in its own transaction so the HTTP ack happens strictly after commit.
 *
 * <p>If the database is down (its circuit is open, or the insert fails), the reading is parked in
 * the spool, the policy's meter fallback, and acknowledged only once that file is on disk. A
 * replay job inserts it later; the unique constraint makes that safe to repeat. So a reading is
 * either committed or durably parked before the meter is told "accepted", and never counted twice.
 */
@Service
public class MeterService {

    private static final Logger log = LoggerFactory.getLogger(MeterService.class);

    private final MeterRepository repo;
    private final ObjectMapper json;
    private final StorageGuard guard;
    private final TransactionTemplate tx;
    private final MeterSpool spool;
    private final Bulkheads bulkheads;

    public MeterService(MeterRepository repo, ObjectMapper json, StorageGuard guard, TransactionTemplate tx,
                        MeterSpool spool, Bulkheads bulkheads) {
        this.repo = repo;
        this.json = json;
        this.guard = guard;
        this.tx = tx;
        this.spool = spool;
        this.bulkheads = bulkheads;
    }

    public enum Result { ACCEPTED, DUPLICATE }

    /** The answer, and whether it was parked in the spool instead of committed. */
    public record Ingested(Result result, boolean spooled) {
    }

    public Ingested ingest(String idempotencyKey, MeterReadingFile body, String traceId) {
        // Meter readings have their own workers: a storm of uploads elsewhere cannot slow them down.
        try (Bulkheads.Permit ignored = bulkheads.enter(Category.METER)) {
            return ingestLimited(idempotencyKey, body, traceId);
        }
    }

    private Ingested ingestLimited(String idempotencyKey, MeterReadingFile body, String traceId) {
        // A retry of a reading that is still parked: already accepted, do not park or insert it again.
        if (spool.contains(idempotencyKey)) {
            return new Ingested(Result.DUPLICATE, true);
        }
        String raw;
        try {
            raw = json.writeValueAsString(body);
        } catch (Exception e) {
            throw ApiException.badRequest("invalid meter reading body");
        }
        try {
            boolean inserted = guard.call(Storage.DB, () ->
                    tx.execute(status -> repo.insertIfNew(idempotencyKey, body, raw, traceId)));
            // Log meter_id + result only; a meter reading carries no personal file content.
            log.info("meter reading meter_id={} seq={} result={}",
                    body.meterId(), body.seq(), inserted ? "accepted" : "duplicate");
            return new Ingested(inserted ? Result.ACCEPTED : Result.DUPLICATE, false);
        } catch (StorageDownException e) {
            return park(idempotencyKey, body, traceId);
        }
    }

    private Ingested park(String idempotencyKey, MeterReadingFile body, String traceId) {
        try {
            boolean parked = spool.put(idempotencyKey, body, traceId);
            log.info("meter reading parked in the spool meter_id={} seq={}", body.meterId(), body.seq());
            return new Ingested(parked ? Result.ACCEPTED : Result.DUPLICATE, true);
        } catch (IOException e) {
            // Neither the database nor the spool took it. Say so: the meter keeps it and retries.
            log.error("meter reading could not be parked meter_id={} seq={}", body.meterId(), body.seq());
            throw ApiException.storageUnavailable("neither the database nor the spool accepted the reading");
        }
    }
}
