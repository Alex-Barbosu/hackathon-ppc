package ro.ppc.filegrid.tus;

import java.time.Instant;
import java.util.UUID;
import ro.ppc.filegrid.domain.Category;

/**
 * One resumable upload. {@code offset} is the byte count the client may rely on: every byte
 * below it is durable (in a finished S3 part, or in the leftover object). {@code partSize}
 * is fixed for the life of the upload so a part number always maps to the same byte range.
 */
public record TusUpload(
        UUID id,
        Category category,
        String region,
        String originalName,
        String contentType,
        String uploadedBy,
        String bucket,
        String objectKey,
        String s3UploadId,
        long length,
        int partSize,
        long offset,
        long busyMs,
        String traceId,
        Instant completedAt,
        Instant createdAt,
        Instant updatedAt) {

    public boolean completed() {
        return completedAt != null;
    }

    /** Bytes held in the leftover object: the part of {@code offset} that has not filled a part. */
    public int tailLength() {
        return completed() ? 0 : (int) (offset % partSize);
    }

    /** Bytes already in finished S3 parts. */
    public long partBytes() {
        return offset - tailLength();
    }
}
