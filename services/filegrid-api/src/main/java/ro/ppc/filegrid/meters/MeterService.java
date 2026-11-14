package ro.ppc.filegrid.meters;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;

/**
 * Idempotent meter-reading ingest. The DB unique constraint is the source of truth; this
 * service only decides accepted vs duplicate from whether the insert created a row. The
 * write runs in its own transaction so the HTTP ack happens strictly after commit — a
 * crash before commit leaves nothing acked and the device safely retries.
 */
@Service
public class MeterService {

    private static final Logger log = LoggerFactory.getLogger(MeterService.class);

    private final MeterRepository repo;
    private final ObjectMapper json;

    public MeterService(MeterRepository repo, ObjectMapper json) {
        this.repo = repo;
        this.json = json;
    }

    public enum Result { ACCEPTED, DUPLICATE }

    @Transactional
    public Result ingest(String idempotencyKey, MeterReadingFile body, String traceId) {
        String raw;
        try {
            raw = json.writeValueAsString(body);
        } catch (Exception e) {
            throw ApiException.badRequest("invalid meter reading body");
        }
        boolean inserted = repo.insertIfNew(idempotencyKey, body, raw, traceId);
        // Log meter_id + result only; a meter reading carries no personal file content.
        log.info("meter reading meter_id={} seq={} result={}",
                body.meterId(), body.seq(), inserted ? "accepted" : "duplicate");
        return inserted ? Result.ACCEPTED : Result.DUPLICATE;
    }
}
