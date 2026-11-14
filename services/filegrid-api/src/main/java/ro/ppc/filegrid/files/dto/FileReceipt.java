package ro.ppc.filegrid.files.dto;

import java.time.OffsetDateTime;

/** FileReceipt schema (contracts/openapi.yaml). signature is the HMAC of the receipt fields (P3). */
public record FileReceipt(
        String id,
        String category,
        String storage,
        long sizeBytes,
        String sha256,
        OffsetDateTime storedAt,
        boolean encrypted,
        String traceId,
        String signature) {
}
