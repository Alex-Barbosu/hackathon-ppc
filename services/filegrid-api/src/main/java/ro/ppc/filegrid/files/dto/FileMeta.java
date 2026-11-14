package ro.ppc.filegrid.files.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;
import java.util.Map;

/** FileMeta schema: FileReceipt fields plus descriptive metadata (contracts/openapi.yaml). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FileMeta(
        String id,
        String category,
        String storage,
        long sizeBytes,
        String sha256,
        OffsetDateTime storedAt,
        boolean encrypted,
        String traceId,
        String signature,
        String originalName,
        String contentType,
        String region,
        String county,
        String description,
        Map<String, Object> recording,
        String uploadedBy,
        OffsetDateTime lastVerifiedAt,
        String status) {
}
