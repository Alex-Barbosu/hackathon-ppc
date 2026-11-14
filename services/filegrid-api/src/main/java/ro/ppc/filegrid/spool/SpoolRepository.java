package ro.ppc.filegrid.spool;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/** The {@code spool_items} table (contracts/db.md): the index of what is parked and why it is waiting. */
@Repository
public class SpoolRepository {

    /** Wait this long before the first replay: the primary was just refused, so give it a moment. */
    private static final int FIRST_ATTEMPT_DELAY_SECONDS = 5;

    private final JdbcTemplate jdbc;

    public SpoolRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(UUID fileId, Category category, Storage target, String path) {
        jdbc.update("INSERT INTO spool_items (file_id, category, target_storage, spool_path, next_attempt_at) "
                        + "VALUES (?::uuid, ?, ?, ?, now() + (? * interval '1 second'))",
                fileId.toString(), category.slug(), target.slug(), path, FIRST_ATTEMPT_DELAY_SECONDS);
    }

    /**
     * Takes up to {@code limit} due items for storages in {@code allowed}. Taking an item pushes its
     * next attempt {@code leaseSeconds} into the future, so another replica skips it, and a replica
     * that dies mid-replay releases it again when the lease runs out.
     */
    public List<SpoolItem> claimDue(Collection<Storage> allowed, int limit, int leaseSeconds) {
        if (allowed.isEmpty()) {
            return List.of();
        }
        String marks = String.join(",", allowed.stream().map(s -> "?").toList());
        Object[] args = new Object[allowed.size() + 2];
        args[0] = leaseSeconds;
        int i = 1;
        for (Storage s : allowed) {
            args[i++] = s.slug();
        }
        args[i] = limit;
        return jdbc.query("UPDATE spool_items SET attempts = attempts + 1, "
                        + "next_attempt_at = now() + (? * interval '1 second') "
                        + "WHERE id IN (SELECT id FROM spool_items WHERE next_attempt_at <= now() "
                        + "AND target_storage IN (" + marks + ") ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED) "
                        + "RETURNING id, file_id, category, target_storage, spool_path, attempts",
                (rs, n) -> new SpoolItem(rs.getLong("id"), UUID.fromString(rs.getString("file_id")),
                        Category.fromSlug(rs.getString("category")), Storage.fromSlug(rs.getString("target_storage")),
                        rs.getString("spool_path"), rs.getInt("attempts")),
                args);
    }

    public void markFailed(long id, String error, int retryInSeconds) {
        jdbc.update("UPDATE spool_items SET last_error = ?, next_attempt_at = now() + (? * interval '1 second') "
                + "WHERE id = ?", truncate(error), retryInSeconds, id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM spool_items WHERE id = ?", id);
    }

    public Map<Category, Long> pendingByCategory() {
        Map<Category, Long> out = new HashMap<>();
        jdbc.query("SELECT category, count(*) AS n FROM spool_items GROUP BY category",
                rs -> {
                    out.put(Category.fromSlug(rs.getString("category")), rs.getLong("n"));
                });
        return out;
    }

    private static String truncate(String s) {
        return s == null ? null : (s.length() > 200 ? s.substring(0, 200) : s);
    }
}
