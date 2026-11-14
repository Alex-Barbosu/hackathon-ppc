package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.audit.AuditLogService;
import ro.ppc.filegrid.common.ApiException;

/**
 * Changes the policy while the API runs (backlog item 8): {@code PUT /policy}, an edit of
 * {@code config/policy.yaml}, and several replicas staying in agreement.
 *
 * <p><b>Where the truth lives.</b> The file is the starting point. Every policy that is applied
 * after that is a row in {@code policy_versions}, and the newest row is the policy in force. The
 * file cannot be the store because it is mounted read-only, and a database row is visible to
 * every replica. Each replica checks the table every few seconds and switches when it finds a
 * newer version, so a change made through one replica reaches the others within about 3 s.
 *
 * <p><b>Versions.</b> The server numbers them (latest + 1). A client's {@code version} is not used,
 * so "Apply" cannot fail because the client held a stale number. Applying a policy that equals the
 * one in force records nothing.
 *
 * <p><b>The file.</b> An edit made while the API runs is applied as a new version. A file that
 * does not validate is logged and ignored: a typo must never replace a working policy. After a
 * restart the newest applied version wins over the file, so a policy set through the API survives.
 *
 * <p>Each change and its audit event commit in one transaction; if the event cannot be written the
 * policy is not changed.
 */
@Service
public class PolicyManager {

    private static final Logger log = LoggerFactory.getLogger(PolicyManager.class);
    private static final int HISTORY_LIMIT = 50;

    private final PolicyService policy;
    private final PolicyStore store;
    private final AuditLogService audit;
    private final TransactionTemplate tx;

    private volatile boolean bootstrapped;
    private volatile long handledFileStamp = Long.MIN_VALUE;

    public PolicyManager(PolicyService policy, PolicyStore store, AuditLogService audit, TransactionTemplate tx) {
        this.policy = policy;
        this.store = store;
        this.audit = audit;
        this.tx = tx;
    }

    // ------------------------------------------------------------- startup and sync

    @EventListener(ApplicationReadyEvent.class)
    public void bootstrap() {
        try {
            tx.executeWithoutResult(status -> {
                store.lock();
                Optional<PolicyVersion> latest = store.latest();
                if (latest.isPresent()) {
                    // An applied policy outranks the file: it was set after the file was written.
                    policy.install(latest.get().policy());
                } else {
                    // First start: the file's policy becomes version history's first entry.
                    Policy fromFile = policy.current();
                    store.insert(new PolicyVersion(fromFile.version(), now(), "file", fromFile));
                    audit.append("file", "policy.update", null, details(null, fromFile, "file", "initial policy"));
                }
            });
            handledFileStamp = fileStamp();
            bootstrapped = true;
        } catch (RuntimeException e) {
            // Typically the database is not reachable yet. The file's policy is already in use; try again next tick.
            log.warn("policy bootstrap deferred: {}", e.getClass().getSimpleName());
        }
    }

    @Scheduled(initialDelayString = "PT3S", fixedDelayString = "PT3S")
    public void sync() {
        if (!bootstrapped) {
            bootstrap();
            return;
        }
        try {
            syncFromDatabase();
        } catch (RuntimeException e) {
            log.debug("policy sync skipped: {}", e.getClass().getSimpleName());
            return; // the database is down; a file edit cannot be recorded either
        }
        syncFromFile();
    }

    /** Another replica applied a newer version: switch to it. */
    void syncFromDatabase() {
        store.latest().ifPresent(latest -> {
            if (latest.version() > policy.current().version()) {
                policy.install(latest.policy());
            }
        });
    }

    /** The file was edited while running: apply it as a new version, if it is valid. */
    void syncFromFile() {
        long stamp = fileStamp();
        if (stamp == handledFileStamp) {
            return;
        }
        Policy candidate;
        try {
            candidate = policy.parseYaml(Files.readString(policy.policyFile()));
        } catch (PolicyValidationException e) {
            handledFileStamp = stamp; // do not repeat the same complaint every 3 s
            log.error("policy file edit ignored, the policy in force is unchanged: {}", e.getMessage());
            return;
        } catch (IOException e) {
            return; // mid-write or unreadable: look again next tick
        }
        try {
            commit(candidate, "file", "file");
            handledFileStamp = stamp;
        } catch (RuntimeException e) {
            // Could not be recorded (database down): leave the stamp so it is tried again.
            log.warn("policy file edit not applied yet: {}", e.getClass().getSimpleName());
        }
    }

    // ------------------------------------------------------------------- the API

    /**
     * Validates {@code body} exactly as the file is validated and, if it is a change, records it as
     * the next version and puts it in force. Throws {@link PolicyValidationException} (a 400) if
     * it is not valid. Returns the policy now in force, with its version.
     */
    public Policy apply(JsonNode body, String actor) {
        Policy candidate = policy.validate(body);
        try {
            return commit(candidate, actor, "api");
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            log.error("policy change could not be recorded: {}", e.getClass().getSimpleName());
            throw ApiException.storageUnavailable("could not record the policy change; nothing was applied");
        }
    }

    /** Newest first. */
    public List<PolicyVersion> history() {
        return store.history(HISTORY_LIMIT);
    }

    // ---------------------------------------------------------------- internals

    private Policy commit(Policy candidate, String actor, String source) {
        Policy result = tx.execute(status -> {
            store.lock();
            Optional<PolicyVersion> latest = store.latest();
            Policy base = latest.map(PolicyVersion::policy).orElse(policy.current());
            if (base.categories().equals(candidate.categories())) {
                return base; // nothing to apply
            }
            int next = base.version() + 1;
            Policy stored = new Policy(next, candidate.categories());
            store.insert(new PolicyVersion(next, now(), actor, stored));
            audit.append(actor, "policy.update", null, details(base, stored, source, PolicyService.describeChanges(base, stored)));
            return stored;
        });
        policy.install(result);
        return result;
    }

    private static Map<String, Object> details(Policy from, Policy to, String source, String changes) {
        Map<String, Object> d = new LinkedHashMap<>();
        if (from != null) {
            d.put("from", from.version());
        }
        d.put("to", to.version());
        d.put("source", source);
        d.put("changes", changes);
        return d;
    }

    private long fileStamp() {
        try {
            return Files.getLastModifiedTime(policy.policyFile()).toMillis();
        } catch (IOException e) {
            return Long.MIN_VALUE;
        }
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
