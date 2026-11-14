package ro.ppc.filegrid.files;

import java.time.OffsetDateTime;
import java.util.UUID;

/** A row of the {@code files} table. Mirrors contracts/db.md columns we use in P0. */
public record FileRow(
        UUID id,
        String category,
        String storage,
        String objectKey,
        long sizeBytes,
        String sha256,
        String contentType,
        String originalName,
        String description,
        String region,
        String county,
        String uploadedBy,
        boolean encrypted,
        String status,
        String traceId,
        OffsetDateTime createdAt,
        OffsetDateTime lastVerifiedAt,
        String metadata) {

    /** A row before it is read back: {@code metadata} is written separately, by {@link FileRepository#insert}. */
    public FileRow(UUID id, String category, String storage, String objectKey, long sizeBytes, String sha256,
                   String contentType, String originalName, String description, String region, String county,
                   String uploadedBy, boolean encrypted, String status, String traceId, OffsetDateTime createdAt,
                   OffsetDateTime lastVerifiedAt) {
        this(id, category, storage, objectKey, sizeBytes, sha256, contentType, originalName, description, region,
                county, uploadedBy, encrypted, status, traceId, createdAt, lastVerifiedAt, null);
    }
}
