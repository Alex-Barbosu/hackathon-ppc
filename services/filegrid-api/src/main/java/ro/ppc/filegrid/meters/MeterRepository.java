package ro.ppc.filegrid.meters;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;

/**
 * Writes {@code meter_readings} with ON CONFLICT DO NOTHING on the unique
 * {@code (meter_id, period_start, seq)}. The insert itself is the idempotency gate, so a
 * retry with the same key never produces a second row (billing guarantee). The method
 * returns true only when THIS call inserted the row.
 *
 * <p>The reading's intervals go into {@code meter_intervals} (one row per meter and timestamp) in the same call, so
 * in the caller's transaction: the reading and its intervals are stored together or not at all. A retry finds the
 * reading already there and writes nothing, and the interval insert is ON CONFLICT DO NOTHING on its own key too.
 * That table is what the anomaly analysis (Section 5) reads; the untouched reading stays in {@code raw}.
 */
@Repository
public class MeterRepository {

    private static final Logger log = LoggerFactory.getLogger(MeterRepository.class);

    /** numeric(10,4): at most 6 digits before the point. */
    private static final int KWH_INTEGER_DIGITS = 6;
    /** numeric(6,2): at most 4 digits before the point. */
    private static final int VOLTAGE_INTEGER_DIGITS = 4;

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
        if (rows == 1) {
            insertIntervals(body);
        }
        return rows == 1;
    }

    /** One interval ready to store: values the columns can hold. */
    private record Row(String meterId, Timestamp ts, BigDecimal kwh, BigDecimal voltage, String[] flags) {
    }

    /**
     * Stores the reading's intervals. An interval with no timestamp or no usable kwh cannot be a row (the column is
     * NOT NULL) and is skipped; a voltage that does not fit is stored as null. An absurd value must not make the
     * database refuse the whole reading: the meter would retry for ever, and the reading is the billing record.
     * The original is in {@code raw} either way.
     */
    private void insertIntervals(MeterReadingFile body) {
        if (body.intervals() == null || body.intervals().isEmpty()) {
            return;
        }
        List<Row> rows = body.intervals().stream()
                .filter(i -> i != null && i.ts() != null)
                .map(i -> toRow(body.meterId(), i))
                .filter(r -> r != null)
                .toList();
        int skipped = body.intervals().size() - rows.size();
        if (skipped > 0) {
            log.warn("meter reading meter_id={} seq={} had {} interval(s) that cannot be stored (kept in raw)",
                    body.meterId(), body.seq(), skipped);
        }
        if (rows.isEmpty()) {
            return;
        }
        jdbc.batchUpdate(
                "INSERT INTO meter_intervals (meter_id, ts, kwh, voltage, flags) VALUES (?,?,?,?,?) "
                        + "ON CONFLICT (meter_id, ts) DO NOTHING",
                new BatchPreparedStatementSetter() {
                    @Override
                    public void setValues(PreparedStatement ps, int i) throws SQLException {
                        Row r = rows.get(i);
                        ps.setString(1, r.meterId());
                        ps.setTimestamp(2, r.ts());
                        ps.setBigDecimal(3, r.kwh());
                        ps.setBigDecimal(4, r.voltage());
                        ps.setArray(5, ps.getConnection().createArrayOf("text", r.flags()));
                    }

                    @Override
                    public int getBatchSize() {
                        return rows.size();
                    }
                });
    }

    private static Row toRow(String meterId, MeterReadingFile.Interval i) {
        BigDecimal kwh = decimal(i.kwh(), 4, KWH_INTEGER_DIGITS);
        if (kwh == null) {
            return null;
        }
        List<String> flags = i.flags() == null ? List.of() : i.flags().stream().filter(f -> f != null).toList();
        return new Row(meterId, Timestamp.from(i.ts().toInstant()), kwh,
                decimal(i.voltage(), 2, VOLTAGE_INTEGER_DIGITS), flags.toArray(new String[0]));
    }

    /** The value at {@code scale} decimals, or null if it is missing, not a number or too big for the column. */
    static BigDecimal decimal(Double v, int scale, int integerDigits) {
        if (v == null || v.isNaN() || v.isInfinite()) {
            return null;
        }
        BigDecimal d = BigDecimal.valueOf(v).setScale(scale, RoundingMode.HALF_UP);
        return d.precision() - d.scale() > integerDigits ? null : d;
    }
}
