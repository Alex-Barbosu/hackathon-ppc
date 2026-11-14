package ro.ppc.filegrid.policy;

import java.time.OffsetDateTime;

/** One row of {@code policy_versions}: a policy that was applied, when, and by whom (PolicyVersion in openapi.yaml). */
public record PolicyVersion(int version, OffsetDateTime appliedAt, String appliedBy, Policy policy) {
}
