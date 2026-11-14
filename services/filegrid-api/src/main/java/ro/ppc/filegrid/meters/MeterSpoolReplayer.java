package ro.ppc.filegrid.meters;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.resilience.StorageDownException;
import ro.ppc.filegrid.resilience.StorageGuard;
import ro.ppc.filegrid.spool.SpoolGauges;

/**
 * Inserts parked meter readings once the database is back. The insert is the same
 * {@code ON CONFLICT DO NOTHING} as a live reading, so a reading that somehow reached the database
 * meanwhile is simply not inserted twice. The reading was already counted as accepted when it was
 * parked, so replaying does not touch {@code filegrid_meter_readings_total}.
 */
@Service
public class MeterSpoolReplayer {

    private static final Logger log = LoggerFactory.getLogger(MeterSpoolReplayer.class);
    private static final int BATCH = 200;

    private final MeterSpool spool;
    private final MeterRepository repo;
    private final ObjectMapper json;
    private final StorageGuard guard;
    private final TransactionTemplate tx;
    private final SpoolGauges gauges;

    public MeterSpoolReplayer(MeterSpool spool, MeterRepository repo, ObjectMapper json, StorageGuard guard,
                              TransactionTemplate tx, SpoolGauges gauges) {
        this.spool = spool;
        this.repo = repo;
        this.json = json;
        this.guard = guard;
        this.tx = tx;
        this.gauges = gauges;
    }

    @Scheduled(initialDelayString = "PT10S", fixedDelayString = "PT3S")
    public void run() {
        try {
            replay();
        } catch (IOException | RuntimeException e) {
            log.warn("meter spool replay stopped: {}", e.getClass().getSimpleName());
        }
        gauges.set(Category.METER, spool.count());
    }

    /** Replays what is parked. Returns how many readings were inserted or recognised as already stored. */
    public int replay() throws IOException {
        if (!guard.allows(Storage.DB)) {
            return 0; // the circuit is open: do not hammer a database that is down
        }
        int done = 0;
        List<MeterSpool.Claim> claims = spool.claim(BATCH);
        for (int i = 0; i < claims.size(); i++) {
            MeterSpool.Claim claim = claims.get(i);
            MeterSpool.Parked p = claim.parked();
            try {
                String raw = json.writeValueAsString(p.reading());
                guard.call(Storage.DB, () -> tx.execute(status ->
                        repo.insertIfNew(p.idempotencyKey(), p.reading(), raw, p.traceId())));
                spool.done(claim);
                done++;
            } catch (StorageDownException e) {
                // The database is still down, so the rest would fail the same way. Give back every
                // reading taken in this round, or they would stay locked until the claim goes stale.
                for (int k = i; k < claims.size(); k++) {
                    spool.release(claims.get(k));
                }
                break;
            } catch (DataIntegrityViolationException e) {
                // Retrying cannot help, and it must not block the readings behind it.
                spool.reject(claim);
            }
        }
        if (done > 0) {
            log.info("meter spool replayed readings={}", done);
        }
        return done;
    }
}
