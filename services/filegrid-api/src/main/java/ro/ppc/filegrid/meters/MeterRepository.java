package ro.ppc.filegrid.meters;

import java.sql.Timestamp;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;

/**
 * Writes {@code meter_readings} with ON CONFLICT DO NOTHING on the unique
 * {@code (meter_id, period_start, seq)}. The insert itself is the idempotency gate, so a
 * retry with the same key never produces a second row (billing guarantee). The method
 * returns true only when THIS call inserted the row.
 */
@Repository
public class MeterRepository {

    private final JdbcTemplate jdbc;

    public MeterRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** @return true if a new row was inserted, false if it already existed (duplicate). */
    public boolean insertIfNew(String idempotencyKey, MeterReadingFile body, String rawJson,
                               String traceId) {
        // Bind the jsonb as a string and let Postgres cast it (?::jsonb), so we don't need
        // the driver's PGobject on the compile classpath.
        int rows = jdbc.update(
                "INSERT INTO meter_readings "
                        + "(meter_id, region, county, lat, lon, period_start, seq, "
                        + " idempotency_key, raw, trace_id) "
                        + "VALUES (?,?,?,?,?,?,?,?,?::jsonb,?) "
                        + "ON CONFLICT (meter_id, period_start, seq) DO NOTHING",
                body.meterId(), body.region(), body.county(), body.lat(), body.lon(),
                Timestamp.from(body.periodStart().toInstant()), body.seq(),
                idempotencyKey, rawJson, traceId);
        return rows == 1;
    }
}
