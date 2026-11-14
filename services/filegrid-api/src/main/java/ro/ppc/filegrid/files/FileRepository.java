package ro.ppc.filegrid.files;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** Reads and writes the {@code files} table. Document names are never logged from here. */
@Repository
public class FileRepository {

    private final JdbcTemplate jdbc;

    public FileRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final RowMapper<FileRow> MAPPER = (rs, i) -> new FileRow(
            UUID.fromString(rs.getString("id")),
            rs.getString("category"),
            rs.getString("storage"),
            rs.getString("object_key"),
            rs.getLong("size_bytes"),
            rs.getString("sha256"),
            rs.getString("content_type"),
            rs.getString("original_name"),
            rs.getString("description"),
            rs.getString("region"),
            rs.getString("county"),
            rs.getString("uploaded_by"),
            rs.getBoolean("encrypted"),
            rs.getString("status"),
            rs.getString("trace_id"),
            toOdt(rs.getTimestamp("created_at")),
            toOdt(rs.getTimestamp("last_verified_at")));

    public void insert(FileRow f) {
        jdbc.update(
                "INSERT INTO files (id, category, storage, object_key, size_bytes, sha256, "
                        + "content_type, original_name, description, region, county, uploaded_by, "
                        + "encrypted, status, trace_id) "
                        + "VALUES (?::uuid,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                f.id().toString(), f.category(), f.storage(), f.objectKey(), f.sizeBytes(),
                f.sha256(), f.contentType(), f.originalName(), f.description(), f.region(),
                f.county(), f.uploadedBy(), f.encrypted(), f.status(), f.traceId());
    }

    public Optional<FileRow> find(UUID id) {
        List<FileRow> rows = jdbc.query(
                "SELECT * FROM files WHERE id = ?::uuid", MAPPER, id.toString());
        return rows.stream().findFirst();
    }

    public void markVerified(UUID id) {
        jdbc.update("UPDATE files SET last_verified_at = now() WHERE id = ?::uuid", id.toString());
    }

    public void markCorrupt(UUID id) {
        jdbc.update("UPDATE files SET status = 'corrupt' WHERE id = ?::uuid", id.toString());
    }

    /**
     * Search by optional category/region, free text over name+description, created-at window,
     * paged. Parameters are bound, never interpolated.
     */
    public SearchResult search(String category, String q, String region,
                               OffsetDateTime from, OffsetDateTime to, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (category != null) {
            where.append(" AND category = ?");
            args.add(category);
        }
        if (region != null) {
            where.append(" AND region = ?");
            args.add(region);
        }
        if (q != null && !q.isBlank()) {
            where.append(" AND (original_name ILIKE ? OR description ILIKE ?)");
            String like = "%" + q + "%";
            args.add(like);
            args.add(like);
        }
        if (from != null) {
            where.append(" AND created_at >= ?");
            args.add(Timestamp.from(from.toInstant()));
        }
        if (to != null) {
            where.append(" AND created_at <= ?");
            args.add(Timestamp.from(to.toInstant()));
        }

        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM files" + where, Long.class, args.toArray());

        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<FileRow> items = jdbc.query(
                "SELECT * FROM files" + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?",
                MAPPER, pageArgs.toArray());

        return new SearchResult(items, total == null ? 0 : total);
    }

    public record SearchResult(List<FileRow> items, long total) {}

    private static OffsetDateTime toOdt(Timestamp ts) {
        return ts == null ? null : ts.toInstant().atOffset(ZoneOffset.UTC);
    }
}
