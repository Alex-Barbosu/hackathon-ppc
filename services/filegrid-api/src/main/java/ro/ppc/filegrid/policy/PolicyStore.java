package ro.ppc.filegrid.policy;

import java.util.List;
import java.util.Optional;

/** Persistence for applied policies (the {@code policy_versions} table). An interface so the logic can be tested without a database. */
public interface PolicyStore {

    /**
     * Serialises writers across replicas until the current transaction ends, so two replicas
     * cannot both create "version N+1". Must be called inside a transaction.
     */
    void lock();

    /** The newest version, if any policy has been applied. */
    Optional<PolicyVersion> latest();

    /** Newest first. */
    List<PolicyVersion> history(int limit);

    void insert(PolicyVersion version);
}
