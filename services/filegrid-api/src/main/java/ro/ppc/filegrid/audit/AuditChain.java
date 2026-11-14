package ro.ppc.filegrid.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import ro.ppc.filegrid.common.Hashing;

/**
 * The hash-chain rule, kept free of the database so it can be tested and re-implemented
 * elsewhere (scripts/audit_check.py does exactly this in Python).
 *
 * <pre>hash = hex(sha256( prev_hash + event_json ))</pre>
 * where {@code prev_hash} is the previous row's hash (64 zeros for the first row) and
 * {@code event_json} is compact JSON with every key sorted, holding
 * {@code action, actor, at, details, file_id}; {@code at} is microseconds since the epoch, an
 * integer, so no time-format difference can change a hash. Details must hold only strings,
 * integers and booleans, and never a file name.
 */
public final class AuditChain {

    public static final String GENESIS = "0".repeat(64);

    private static final ObjectMapper CANONICAL = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private AuditChain() {
    }

    public static ObjectMapper mapper() {
        return CANONICAL;
    }

    public static String eventJson(long atMicros, String actor, String action, String fileId,
                                   Map<String, Object> details) {
        Map<String, Object> event = new TreeMap<>();
        event.put("action", action);
        event.put("actor", actor);
        event.put("at", atMicros);
        event.put("details", details);
        event.put("file_id", fileId);
        try {
            return CANONICAL.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot serialise audit event", e);
        }
    }

    public static String hash(String prevHash, String eventJson) {
        return Hashing.hex(Hashing.sha256().digest((prevHash + eventJson).getBytes(StandardCharsets.UTF_8)));
    }

    /** One stored row, as read back from the table. */
    public record Row(long id, long atMicros, String actor, String action, String fileId,
                      Map<String, Object> details, String prevHash, String hash) {
    }

    public record Result(boolean ok, long rows, Long firstBadId, String problem) {
    }

    /** Checks rows one at a time, in id order, so a long log never has to fit in memory. */
    public static final class Verifier {
        private String prev = GENESIS;
        private long rows;
        private Long firstBad;
        private String problem;

        public void accept(Row r) {
            rows++;
            if (firstBad != null) {
                return;
            }
            if (!prev.equals(r.prevHash())) {
                fail(r, "chain broken: prev_hash does not match the previous row (a row was removed or reordered)");
                return;
            }
            String expected = hash(prev, eventJson(r.atMicros(), r.actor(), r.action(), r.fileId(), r.details()));
            if (!expected.equals(r.hash())) {
                fail(r, "row content changed: hash does not match its fields");
                return;
            }
            prev = r.hash();
        }

        private void fail(Row r, String why) {
            firstBad = r.id();
            problem = why;
        }

        public Result result() {
            return new Result(firstBad == null, rows, firstBad, problem);
        }
    }

    public static Result verify(List<Row> rowsInIdOrder) {
        Verifier v = new Verifier();
        rowsInIdOrder.forEach(v::accept);
        return v.result();
    }
}
