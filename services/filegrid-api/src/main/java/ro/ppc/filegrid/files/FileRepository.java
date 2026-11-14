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
        insert(f, null, null);
    }

    /** Also stores the wrapped data key and iv for an encrypted file, in the same statement. */
    public void insert(FileRow f, byte[] wrappedKey, byte[] iv) {
        insert(f, wrappedKey, iv, null);
    }

    /** As above, with the file's own metadata (JSON) for {@code files.metadata}; null leaves the default {@code {}}. */
    public void insert(FileRow f, byte[] wrappedKey, byte[] iv, String metadataJson) {
        jdbc.update(
                "INSERT INTO files (id, category, storage, object_key, size_bytes, sha256, "
                        + "content_type, original_name, description, region, county, uploaded_by, "
                        + "encrypted, status, trace_id, wrapped_key, iv, metadata) "
                        + "VALUES (?::uuid,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?::jsonb, '{}'::jsonb))",
                f.id().toString(), f.category(), f.storage(), f.objectKey(), f.sizeBytes(),
                f.sha256(), f.contentType(), f.originalName(), f.description(), f.region(),
                f.county(), f.uploadedBy(), f.encrypted(), f.status(), f.traceId(), wrappedKey, iv, metadataJson);
    }

    /** Key material of an encrypted file; empty if the file was stored in clear. */
    public Optional<Crypto> findCrypto(UUID id) {
        return jdbc.query("SELECT wrapped_key, iv FROM files WHERE id = ?::uuid AND wrapped_key IS NOT NULL",
                (rs, i) -> new Crypto(rs.getBytes("wrapped_key"), rs.getBytes("iv")), id.toString())
                .stream().findFirst();
    }

    public record Crypto(byte[] wrappedKey, byte[] iv) {}

    public Optional<FileRow> find(UUID id) {
        List<FileRow> rows = jdbc.query(
                "SELECT * FROM files WHERE id = ?::uuid", MAPPER, id.toString());
        return rows.stream().findFirst();
    }

    /**
     * The oldest file that is the same content in the same category and region: same SHA-256 and size, readable
     * ({@code stored} or still {@code spooled}, never {@code corrupt}). Region null matches region null.
     */
    public Optional<FileRow> findDuplicate(String category, String sha256, long sizeBytes, String region) {
        List<FileRow> rows = jdbc.query(
                "SELECT * FROM files WHERE category = ? AND sha256 = ? AND size_bytes = ? "
                        + "AND region IS NOT DISTINCT FROM ? AND status IN ('stored', 'spooled') "
                        + "ORDER BY created_at, id LIMIT 1", MAPPER, category, sha256, sizeBytes, region);
        return rows.stream().findFirst();
    }

    /** Points a file at where its bytes are now (the spool replay moves them to the real storage). */
    public void relocate(UUID id, String storage, String objectKey, String status) {
        jdbc.update("UPDATE files SET storage = ?, object_key = ?, status = ? WHERE id = ?::uuid",
                storage, objectKey, status, id.toString());
    }

    /** Removes the row. Its blob (db storage) and key material go with it. Audit rows are kept: they have no foreign key. */
    public boolean delete(UUID id) {
        return jdbc.update("DELETE FROM files WHERE id = ?::uuid", id.toString()) > 0;
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
