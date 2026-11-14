package ro.ppc.filegrid.storage;

import java.io.InputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Storage;

/**
 * Bytes in the {@code stored_blobs.data} bytea column, keyed by the file id. The guide caps
 * db-stored files at ~50 MB, so a single bytea row (not a large object) is fine.
 *
 * <p>Streaming both ways: {@code setBinaryStream} lets the JDBC driver pull from the body
 * without us materialising it, and the read uses the driver's streaming result so we never
 * call {@code getBytes()} on the whole column. The connection stays open behind the returned
 * stream and closes when the caller closes the stream.
 */
@Component
public class DbStorage implements StorageAdapter {

    private final DataSource dataSource;

    public DbStorage(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Storage kind() {
        return Storage.DB;
    }

    @Override
    public StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception {
        // Count bytes as they stream through so we can report the stored size without buffering.
        CountingInputStream counting = new CountingInputStream(body);
        // Join the caller's transaction if there is one. FileService stores a database file as one
        // transaction (this blob + the files row), and the foreign key is checked at its commit.
        Connection c = DataSourceUtils.getConnection(dataSource);
        try (PreparedStatement ps = c.prepareStatement(
                "INSERT INTO stored_blobs (file_id, data) VALUES (?::uuid, ?) "
                        + "ON CONFLICT (file_id) DO UPDATE SET data = EXCLUDED.data")) {
            ps.setString(1, key);
            ps.setBinaryStream(2, counting);
            ps.executeUpdate();
        } finally {
            DataSourceUtils.releaseConnection(c, dataSource);
        }
        return new StoredRef(Storage.DB, key, counting.count());
    }

    @Override
    public InputStream read(String key) throws Exception {
        Connection c = dataSource.getConnection();
        try {
            PreparedStatement ps = c.prepareStatement(
                    "SELECT data FROM stored_blobs WHERE file_id = ?::uuid");
            ps.setString(1, key);
            ResultSet rs = ps.executeQuery();
            if (!rs.next()) {
                rs.close();
                ps.close();
                c.close();
                return null;
            }
            InputStream raw = rs.getBinaryStream(1);
            // Close the JDBC resources when the caller closes the byte stream.
            return new ClosingInputStream(raw, rs, ps, c);
        } catch (Exception e) {
            c.close();
            throw e;
        }
    }

    @Override
    public void delete(String key) throws Exception {
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(
                     "DELETE FROM stored_blobs WHERE file_id = ?::uuid")) {
            ps.setString(1, key);
            ps.executeUpdate();
        }
    }

    @Override
    public boolean health() {
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement("SELECT 1")) {
            ps.execute();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Closes the ResultSet, statement and connection when the data stream closes. */
    private static final class ClosingInputStream extends InputStream {
        private final InputStream delegate;
        private final ResultSet rs;
        private final PreparedStatement ps;
        private final Connection c;

        ClosingInputStream(InputStream delegate, ResultSet rs, PreparedStatement ps, Connection c) {
            this.delegate = delegate;
            this.rs = rs;
            this.ps = ps;
            this.c = c;
        }

        @Override
        public int read() throws java.io.IOException {
            return delegate.read();
        }

        @Override
        public int read(byte[] b, int off, int len) throws java.io.IOException {
            return delegate.read(b, off, len);
        }

        @Override
        public void close() throws java.io.IOException {
            try {
                delegate.close();
            } finally {
                closeQuietly(rs);
                closeQuietly(ps);
                closeQuietly(c);
            }
        }

        private static void closeQuietly(AutoCloseable a) {
            try {
                a.close();
            } catch (Exception ignored) {
                // best effort; the connection pool reclaims leaked handles
            }
        }
    }
}
