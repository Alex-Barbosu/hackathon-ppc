package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import ro.ppc.filegrid.domain.Storage;

/** One category's routing, mirroring contracts/policy.schema.json $defs/categoryPolicy. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CategoryPolicy(
        String primary,
        String fallback,
        boolean encrypt,
        int maxSizeMb,
        String priority,
        int workers,
        int queue,
        Boolean audit,
        Integer chunkMb) {

    public Storage primaryStorage() {
        return Storage.fromSlug(primary);
    }

    public Storage fallbackStorage() {
        return Storage.fromSlug(fallback);
    }

    public boolean auditEnabled() {
        return Boolean.TRUE.equals(audit);
    }

    public long maxSizeBytes() {
        return (long) maxSizeMb * 1024L * 1024L;
    }
}
