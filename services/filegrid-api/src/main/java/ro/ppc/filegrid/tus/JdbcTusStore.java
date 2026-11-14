package ro.ppc.filegrid.tus;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.files.FileRepository;
import ro.ppc.filegrid.files.FileRow;

@Repository
public class JdbcTusStore implements TusStore {

    private static final RowMapper<TusUpload> MAPPER = (rs, i) -> new TusUpload(
            UUID.fromString(rs.getString("id")),
            Category.fromSlug(rs.getString("category")),
            rs.getString("region"),
            rs.getString("original_name"),
            rs.getString("content_type"),
            rs.getString("uploaded_by"),
            rs.getString("bucket"),
            rs.getString("object_key"),
            rs.getString("s3_upload_id"),
            rs.getLong("upload_length"),
            rs.getInt("part_size"),
            rs.getLong("upload_offset"),
            rs.getLong("busy_ms"),
            rs.getString("trace_id"),
            instant(rs.getTimestamp("completed_at")),
            instant(rs.getTimestamp("created_at")),
            instant(rs.getTimestamp("updated_at")));

    private final JdbcTemplate jdbc;
    private final FileRepository files;
    private final TransactionTemplate tx;

    public JdbcTusStore(JdbcTemplate jdbc, FileRepository files, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.files = files;
        this.tx = tx;
    }

    @Override
    public void insert(TusUpload u) {
        jdbc.update("INSERT INTO tus_uploads (id, category, region, original_name, content_type, "
                        + "uploaded_by, bucket, object_key, s3_upload_id, upload_length, part_size, trace_id) "
                        + "VALUES (?::uuid,?,?,?,?,?,?,?,?,?,?,?)",
                u.id().toString(), u.category().slug(), u.region(), u.originalName(), u.contentType(),
                u.uploadedBy(), u.bucket(), u.objectKey(), u.s3UploadId(), u.length(), u.partSize(),
                u.traceId());
    }

    @Override
    public Optional<TusUpload> find(UUID id) {
        return jdbc.query("SELECT * FROM tus_uploads WHERE id = ?::uuid", MAPPER, id.toString())
                .stream().findFirst();
    }

    @Override
    public boolean advance(UUID id, long expectedOffset, long newOffset, long busyMsDelta) {
        return jdbc.update("UPDATE tus_uploads SET upload_offset = ?, busy_ms = busy_ms + ?, "
                        + "updated_at = now() WHERE id = ?::uuid AND upload_offset = ? AND completed_at IS NULL",
                newOffset, busyMsDelta, id.toString(), expectedOffset) == 1;
    }

    @Override
    public void putPart(UUID id, int partNumber, String etag) {
        jdbc.update("INSERT INTO tus_parts (upload_id, part_number, etag) VALUES (?::uuid,?,?) "
                + "ON CONFLICT (upload_id, part_number) DO UPDATE SET etag = EXCLUDED.etag",
                id.toString(), partNumber, etag);
    }

    @Override
    public List<PartRef> parts(UUID id) {
        return jdbc.query("SELECT part_number, etag FROM tus_parts WHERE upload_id = ?::uuid "
                        + "ORDER BY part_number",
                (rs, i) -> new PartRef(rs.getInt("part_number"), rs.getString("etag")), id.toString());
    }

    @Override
    public void complete(UUID id, FileRow file, long busyMsDelta) {
        // One transaction: a finished upload either has its files row and is marked done, or neither.
        tx.executeWithoutResult(status -> {
            files.insert(file);
            jdbc.update("UPDATE tus_uploads SET completed_at = now(), upload_offset = upload_length, "
                    + "busy_ms = busy_ms + ?, updated_at = now() WHERE id = ?::uuid",
                    busyMsDelta, id.toString());
        });
    }

    @Override
    public List<TusUpload> findIdleSince(Instant cutoff) {
        return jdbc.query("SELECT * FROM tus_uploads WHERE updated_at < ?", MAPPER, Timestamp.from(cutoff));
    }

    @Override
    public void delete(UUID id) {
        jdbc.update("DELETE FROM tus_uploads WHERE id = ?::uuid", id.toString());
    }

    private static Instant instant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}
