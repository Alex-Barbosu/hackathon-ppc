package ro.ppc.filegrid.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.audit.AuditChain.Row;

class AuditChainTest {

    private static final String FILE = "6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60";

    /** Builds rows the way the service does: each row's prev_hash is the one before's hash. */
    private static List<Row> chain(int n) {
        List<Row> rows = new ArrayList<>();
        String prev = AuditChain.GENESIS;
        for (int i = 1; i <= n; i++) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("category", "document");
            details.put("result", "ok");
            long at = 1_700_000_000_000_000L + i;
            String hash = AuditChain.hash(prev, AuditChain.eventJson(at, "user" + i, "file.read", FILE, details));
            rows.add(new Row(i, at, "user" + i, "file.read", FILE, details, prev, hash));
            prev = hash;
        }
        return rows;
    }

    private static Row with(Row r, String actor, Map<String, Object> details, String prevHash, String hash) {
        return new Row(r.id(), r.atMicros(), actor, r.action(), r.fileId(), details, prevHash, hash);
    }

    @Test
    void anUntouchedChainVerifies() {
        var result = AuditChain.verify(chain(5));

        assertThat(result.ok()).isTrue();
        assertThat(result.rows()).isEqualTo(5);
        assertThat(result.firstBadId()).isNull();
    }

    @Test
    void anEmptyLogIsValid() {
        assertThat(AuditChain.verify(List.of()).ok()).isTrue();
    }

    @Test
    void editingAnyFieldOfARowIsDetectedAtThatRow() {
        List<Row> rows = chain(5);
        Row r = rows.get(2);

        rows.set(2, with(r, "someone-else", r.details(), r.prevHash(), r.hash()));
        assertThat(AuditChain.verify(rows).firstBadId()).isEqualTo(3L);

        rows = chain(5);
        r = rows.get(2);
        Map<String, Object> changed = new LinkedHashMap<>(r.details());
        changed.put("result", "integrity_failed");
        rows.set(2, with(r, r.actor(), changed, r.prevHash(), r.hash()));
        assertThat(AuditChain.verify(rows).firstBadId()).isEqualTo(3L);
    }

    @Test
    void anAttackerWhoRecomputesOneHashStillBreaksTheNextRow() {
        List<Row> rows = chain(5);
        Row r = rows.get(2);
        // Rewrite row 3 and give it a hash that matches its new content.
        String forged = AuditChain.hash(r.prevHash(),
                AuditChain.eventJson(r.atMicros(), "forged", r.action(), r.fileId(), r.details()));
        rows.set(2, with(r, "forged", r.details(), r.prevHash(), forged));

        var result = AuditChain.verify(rows);

        assertThat(result.ok()).isFalse();
        assertThat(result.firstBadId()).as("the row after it no longer links").isEqualTo(4L);
    }

    @Test
    void removingARowFromTheMiddleOrTheStartIsDetected() {
        List<Row> rows = chain(5);
        rows.remove(2);
        assertThat(AuditChain.verify(rows).firstBadId()).isEqualTo(4L);

        rows = chain(5);
        rows.remove(0);
        assertThat(AuditChain.verify(rows).firstBadId()).isEqualTo(2L);
    }

    @Test
    void reorderingRowsIsDetected() {
        List<Row> rows = chain(4);
        Row second = rows.get(1);
        rows.set(1, rows.get(2));
        rows.set(2, second);

        assertThat(AuditChain.verify(rows).ok()).isFalse();
    }

    @Test
    void theHashIgnoresTheOrderDetailsWereBuiltIn() {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("category", "document");
        a.put("result", "ok");
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("result", "ok");
        b.put("category", "document");

        assertThat(AuditChain.eventJson(1, "u", "x", FILE, a)).isEqualTo(AuditChain.eventJson(1, "u", "x", FILE, b));
    }

    /**
     * The same event and hash are computed by scripts/audit_check.py. If this fails, the format
     * changed and the script (and any stored log) no longer agrees with the service.
     */
    @Test
    void theFormatMatchesTheReferenceVectorUsedByThePythonChecker() {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("category", "document");
        details.put("storage", "ftp");
        details.put("result", "ok");
        details.put("size", 2048);
        details.put("encrypted", true);

        String json = AuditChain.eventJson(1_700_000_000_123_456L, "connections", "file.read", FILE, details);

        assertThat(json).isEqualTo("{\"action\":\"file.read\",\"actor\":\"connections\",\"at\":1700000000123456,"
                + "\"details\":{\"category\":\"document\",\"encrypted\":true,\"result\":\"ok\",\"size\":2048,"
                + "\"storage\":\"ftp\"},\"file_id\":\"" + FILE + "\"}");
        assertThat(AuditChain.hash(AuditChain.GENESIS, json))
                .isEqualTo("aafa0e98a19a1c675ede66db926f0e3d314ea6439fc331f11f545878e7622854");
    }
}
