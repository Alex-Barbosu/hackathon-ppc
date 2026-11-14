package ro.ppc.filegrid.audit;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Appends to the hash-chained {@code audit_log}. Rows must chain in id order, but several API
 * replicas write at once, so each append takes a Postgres advisory lock for the length of its
 * transaction, reads the latest hash, and inserts the next row. The lock is released at commit.
 *
 * <p>{@link #append} joins the caller's transaction when there is one, so a file row and its
 * audit event are committed together or not at all.
 */
@Service
public class AuditLogService {

    /** Arbitrary constant; only has to be the same on every replica. */
    private static final long LOCK_KEY = 7_266_179L;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public AuditLogService(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    /** {@code fileId} may be null for an event that is not about one file (a policy change). */
    public void append(String actor, String action, UUID fileId, Map<String, Object> details) {
        tx.executeWithoutResult(status -> {
            jdbc.query("SELECT pg_advisory_xact_lock(?)", (RowCallbackHandler) rs -> { }, LOCK_KEY);
            String prev = jdbc.query("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1",
                    (rs, i) -> rs.getString(1)).stream().findFirst().orElse(AuditChain.GENESIS);

            // Postgres keeps microseconds, so hash exactly what it will store.
            Instant at = Instant.now().truncatedTo(ChronoUnit.MICROS);
            long micros = at.getEpochSecond() * 1_000_000L + at.getNano() / 1_000;
            // Some events, such as a policy change, are not about one file.
            String file = fileId == null ? null : fileId.toString();
            String event = AuditChain.eventJson(micros, actor, action, file, details);
            String detailsJson = detailsJson(details);

            jdbc.update("INSERT INTO audit_log (at, actor, action, file_id, details, prev_hash, hash) "
                            + "VALUES (?,?,?,?::uuid,?::jsonb,?,?)",
                    Timestamp.from(at), actor, action, file, detailsJson,
                    prev, AuditChain.hash(prev, event));
        });
    }

    /** Re-computes the whole chain. For checks and tests; the demo script does the same in Python. */
    public AuditChain.Result verifyChain() {
        AuditChain.Verifier verifier = new AuditChain.Verifier();
        jdbc.query("SELECT id, at, actor, action, file_id, details::text, prev_hash, hash "
                + "FROM audit_log ORDER BY id", (RowCallbackHandler) rs -> {
            Instant at = rs.getTimestamp("at").toInstant();
            verifier.accept(new AuditChain.Row(rs.getLong("id"),
                    at.getEpochSecond() * 1_000_000L + at.getNano() / 1_000,
                    rs.getString("actor"), rs.getString("action"), rs.getString("file_id"),
                    parse(rs.getString(6)), rs.getString("prev_hash"), rs.getString("hash")));
        });
        return verifier.result();
    }

    private static String detailsJson(Map<String, Object> details) {
        try {
            return AuditChain.mapper().writeValueAsString(details);
        } catch (Exception e) {
            throw new IllegalStateException("cannot serialise audit details", e);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parse(String json) {
        try {
            return AuditChain.mapper().readValue(json, Map.class);
        } catch (Exception e) {
            throw new IllegalStateException("cannot read audit details", e);
        }
    }
}
