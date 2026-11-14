package ro.ppc.filegrid.tus;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import ro.ppc.filegrid.files.FileRow;

/** Persistence for upload state. An interface so the service can be tested without a database. */
public interface TusStore {

    /** A finished S3 part: its number (1-based) and the ETag S3 returned. */
    record PartRef(int partNumber, String etag) {
    }

    void insert(TusUpload upload);

    Optional<TusUpload> find(UUID id);

    /**
     * Moves the offset forward only if it is still {@code expectedOffset} (compare-and-set), so
     * two requests racing on one upload cannot both win. Returns false when it lost.
     */
    boolean advance(UUID id, long expectedOffset, long newOffset, long busyMsDelta);

    /** Records a finished part; re-sending the same part number replaces it. */
    void putPart(UUID id, int partNumber, String etag);

    /** Parts in ascending part-number order, as S3's complete call needs them. */
    List<PartRef> parts(UUID id);

    /** Atomically writes the {@code files} row and marks the upload completed. */
    void complete(UUID id, FileRow file, long busyMsDelta);

    List<TusUpload> findIdleSince(Instant cutoff);

    void delete(UUID id);
}
