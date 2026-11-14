package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import ro.ppc.filegrid.domain.Storage;

/** One category's routing, mirroring contracts/policy.schema.json $defs/categoryPolicy. */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
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

    public CategoryPolicy {
        // The schema's default for audit is false. Writing it down means "absent" and "false" are
        // the same policy, so applying an unchanged policy is recognised as no change.
        audit = audit != null && audit;
    }

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
