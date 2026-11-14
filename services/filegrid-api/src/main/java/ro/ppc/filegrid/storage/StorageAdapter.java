package ro.ppc.filegrid.storage;

import java.io.InputStream;
import ro.ppc.filegrid.domain.Storage;

/**
 * One backend (db, s3 or ftp). Every method streams: an implementation must never hold a
 * whole file in memory, so a 1 GB upload keeps heap flat (NFR scalability). Writers read
 * {@code body} to end and return where the bytes landed; readers hand back a stream the
 * caller closes.
 */
public interface StorageAdapter {

    /** Which backend this is; used for routing, metrics tags and health reporting. */
    Storage kind();

    /**
     * Write {@code body} under {@code key}. The stream is consumed fully. Implementations
     * must make the object visible only once the whole body is durable (FTP writes
     * {@code key}.part then renames), so a reader never sees a half file.
     */
    StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception;

    /** Open the stored object for streaming read. Caller closes the returned stream. */
    InputStream read(String key) throws Exception;

    /** Remove the object. Idempotent: deleting a missing key is not an error. */
    void delete(String key) throws Exception;

    /** Cheap liveness probe for /storages/health. */
    boolean health();
}
