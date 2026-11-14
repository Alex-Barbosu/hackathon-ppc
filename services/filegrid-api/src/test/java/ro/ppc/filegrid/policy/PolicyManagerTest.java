package ro.ppc.filegrid.policy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.audit.AuditLogService;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/**
 * Changing the policy while the API runs: PUT, a file edit, and replicas staying in agreement. The
 * store and the transaction are in-memory, and the transaction rolls the store back on an error like
 * a database does, so "if the audit event fails, nothing changed" is a real assertion.
 */
class PolicyManagerTest {

    private static final String FILE = """
            version: 1
            categories:
              meter:    { primary: db,  fallback: spool, encrypt: false, maxSizeMb: 1,    priority: high,   workers: 16, queue: 5000 }
              outage:   { primary: s3,  fallback: db,    encrypt: false, maxSizeMb: 20,   priority: high,   workers: 8,  queue: 500 }
              document: { primary: ftp, fallback: s3,    encrypt: true,  maxSizeMb: 20,   priority: normal, workers: 4,  queue: 200, audit: true }
              video:    { primary: s3,  fallback: spool, encrypt: false, maxSizeMb: 5000, priority: low,    workers: 2,  queue: 20,  chunkMb: 16 }
            """;

    private static final ObjectMapper JSON = new ObjectMapper();

    @TempDir
    Path dir;

    private Path file;
    private PolicyService policy;
    private MemoryStore store;
    private AuditLogService audit;
    private PolicyManager manager;

    @BeforeEach
    void setUp() throws Exception {
        file = dir.resolve("policy.yaml");
        Files.writeString(file, FILE);
        Files.setLastModifiedTime(file, FileTime.fromMillis(1_000_000));
        policy = new PolicyService(file.toString());
        store = new MemoryStore();
        audit = mock(AuditLogService.class);
        manager = new PolicyManager(policy, store, audit, new RollbackTx(store));
    }

    /** The policy as the request body of a PUT: the file's, with changes applied by the caller. */
    private JsonNode body(String find, String replace) throws Exception {
        String yaml = find == null ? FILE : FILE.replace(find, replace);
        return new com.fasterxml.jackson.dataformat.yaml.YAMLMapper().readTree(yaml);
    }

    private Policy inForce() {
        return policy.current();
    }

    // ------------------------------------------------------------------ first start

    @Test
    void theFirstStartRecordsTheFilesPolicyAsVersionOne() {
        manager.bootstrap();

        assertThat(store.versions).hasSize(1);
        assertThat(store.versions.get(0).version()).isEqualTo(1);
        assertThat(store.versions.get(0).appliedBy()).isEqualTo("file");
        assertThat(inForce().categories().get("outage").primary()).isEqualTo("s3");
        verify(audit).append(eq("file"), eq("policy.update"), isNull(), any());
    }

    @Test
    void anAppliedPolicyOutranksTheFileAfterARestart() throws Exception {
        manager.bootstrap();
        manager.apply(body("outage:   { primary: s3,", "outage:   { primary: ftp,"), "admin");

        // A new process: it reads the file again (still saying s3), but the database has version 2.
        PolicyService fresh = new PolicyService(file.toString());
        assertThat(fresh.current().categories().get("outage").primary()).isEqualTo("s3");
        new PolicyManager(fresh, store, audit, new RollbackTx(store)).bootstrap();

        assertThat(fresh.current().version()).isEqualTo(2);
        assertThat(fresh.current().categories().get("outage").primary()).isEqualTo("ftp");
        assertThat(store.versions).as("and no extra version was written").hasSize(2);
    }

    @Test
    void ifTheDatabaseIsNotThereYetTheFilesPolicyStaysInUseAndItIsTriedAgain() {
        store.down = true;

        manager.bootstrap();
        assertThat(inForce().version()).isEqualTo(1);
        assertThat(store.versions).isEmpty();

        store.down = false;
        manager.sync(); // the retry
        assertThat(store.versions).hasSize(1);
    }

    // ------------------------------------------------------------------ PUT

    @Test
    void aValidChangeIsAppliedAtOnceAsTheNextVersion() throws Exception {
        manager.bootstrap();

        Policy applied = manager.apply(body("outage:   { primary: s3,", "outage:   { primary: ftp,"), "admin");

        assertThat(applied.version()).isEqualTo(2);
        assertThat(applied.categories().get("outage").primary()).isEqualTo("ftp");
        assertThat(inForce()).as("in force without a restart").isEqualTo(applied);
        assertThat(inForce().categories().get("outage").primaryStorage()).isEqualTo(Storage.FTP);
        assertThat(store.versions.get(1).appliedBy()).isEqualTo("admin");
    }

    @Test
    void theVersionInTheBodyIsIgnoredTheServerNumbersThem() throws Exception {
        manager.bootstrap();

        // The client says "version 99" and changes a value: the server still numbers it 2.
        Policy applied = manager.apply(body("version: 1\ncategories:", "version: 99\ncategories:").deepCopy(), "admin");
        assertThat(applied.version()).as("only the version differs, so there is nothing to apply").isEqualTo(1);

        JsonNode changed = body("queue: 200,", "queue: 300,");
        ((com.fasterxml.jackson.databind.node.ObjectNode) changed).put("version", 99);
        assertThat(manager.apply(changed, "admin").version()).isEqualTo(2);
    }

    @Test
    void applyingTheSamePolicyAgainRecordsNothing() throws Exception {
        manager.bootstrap();
        manager.apply(body("queue: 200,", "queue: 300,"), "admin");

        Policy again = manager.apply(body("queue: 200,", "queue: 300,"), "admin");

        assertThat(again.version()).isEqualTo(2);
        assertThat(store.versions).hasSize(2);
        verify(audit, org.mockito.Mockito.times(2)).append(anyString(), eq("policy.update"), isNull(), any());
    }

    @Test
    void anAbsentAuditFlagAndFalseAreTheSamePolicy() throws Exception {
        manager.bootstrap();

        // The file leaves audit out for outage; a client that sends audit: false has changed nothing.
        Policy again = manager.apply(body("outage:   { primary: s3,  fallback: db,    encrypt: false,",
                "outage:   { audit: false, primary: s3,  fallback: db,    encrypt: false,"), "admin");

        assertThat(again.version()).isEqualTo(1);
    }

    @Test
    void anInvalidPolicyIsRefusedAndNothingChanges() throws Exception {
        manager.bootstrap();
        Policy before = inForce();

        for (JsonNode bad : List.of(
                body("primary: s3,  fallback: db", "primary: minio, fallback: db"),
                body("primary: db,  fallback: spool", "primary: spool, fallback: db"),
                body("workers: 8,", "workers: 0,"),
                body("maxSizeMb: 20,   priority: high,   workers: 8", "maxSizeMb: 20,   priority: urgent,   workers: 8"),
                body("version: 1", "version: one"),
                body("queue: 200,", "queue: 200, color: red,"),
                JSON.readTree("{\"version\":2,\"categories\":{\"meter\":{}}}"),
                JSON.readTree("{}"),
                JSON.readTree("[]"))) {
            assertThatThrownBy(() -> manager.apply(bad, "admin")).isInstanceOf(PolicyValidationException.class);
        }

        assertThat(inForce()).isEqualTo(before);
        assertThat(store.versions).hasSize(1);
    }

    @Test
    void anUnknownKeyIsRefusedNotSilentlyDropped() throws Exception {
        manager.bootstrap();

        assertThatThrownBy(() -> manager.apply(body("queue: 200,", "queue: 200, typoField: 1,"), "admin"))
                .isInstanceOf(PolicyValidationException.class);
    }

    @Test
    void everyChangeIsAuditedWithWhatChangedAndWhoDidIt() throws Exception {
        manager.bootstrap();

        manager.apply(body("encrypt: true,  maxSizeMb: 20,   priority: normal", "encrypt: false, maxSizeMb: 20,   priority: normal"), "admin");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> details = ArgumentCaptor.forClass(Map.class);
        verify(audit).append(eq("admin"), eq("policy.update"), isNull(), details.capture());
        assertThat(details.getValue()).containsEntry("from", 1).containsEntry("to", 2).containsEntry("source", "api");
        assertThat((String) details.getValue().get("changes")).contains("document.encrypt true->false");
    }

    @Test
    void ifTheAuditEventCannotBeWrittenThePolicyIsNotChanged() throws Exception {
        manager.bootstrap();
        Policy before = inForce();
        doThrow(new IllegalStateException("db down")).when(audit).append(eq("admin"), eq("policy.update"), any(), any());

        assertThatThrownBy(() -> manager.apply(body("queue: 200,", "queue: 300,"), "admin"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));

        assertThat(inForce()).as("not applied here").isEqualTo(before);
        assertThat(store.versions).as("and not recorded").hasSize(1);
    }

    @Test
    void theHistoryIsNewestFirst() throws Exception {
        manager.bootstrap();
        manager.apply(body("queue: 200,", "queue: 300,"), "admin");
        manager.apply(body("queue: 200,", "queue: 400,"), "dispatch-admin");

        assertThat(manager.history()).extracting(PolicyVersion::version).containsExactly(3, 2, 1);
        assertThat(manager.history().get(0).appliedBy()).isEqualTo("dispatch-admin");
    }

    // ------------------------------------------------------------------ replicas

    @Test
    void aVersionAppliedByAnotherReplicaIsPickedUpOnTheNextSync() {
        manager.bootstrap();
        Policy newer = new Policy(2, withOutagePrimary("db"));
        store.versions.add(new PolicyVersion(2, OffsetDateTime.now(), "admin", newer));

        manager.sync();

        assertThat(inForce().version()).isEqualTo(2);
        assertThat(inForce().categories().get("outage").primary()).isEqualTo("db");
    }

    @Test
    void anOlderOrEqualVersionInTheDatabaseDoesNotRollBackTheOneInUse() throws Exception {
        manager.bootstrap();
        manager.apply(body("queue: 200,", "queue: 300,"), "admin");
        store.versions.remove(1); // the database only knows version 1 again

        manager.sync();

        assertThat(inForce().version()).isEqualTo(2);
    }

    @Test
    void aDatabaseThatIsDownDuringSyncChangesNothing() {
        manager.bootstrap();
        store.down = true;

        manager.sync();

        assertThat(inForce().version()).isEqualTo(1);
    }

    // ------------------------------------------------------------------ the file

    private void editFile(String content, long stamp) throws Exception {
        Files.writeString(file, content);
        Files.setLastModifiedTime(file, FileTime.fromMillis(stamp));
    }

    @Test
    void aValidEditOfTheFileIsAppliedAsANewVersionWithoutARestart() throws Exception {
        manager.bootstrap();

        editFile(FILE.replace("outage:   { primary: s3,", "outage:   { primary: ftp,"), 2_000_000);
        manager.sync();

        assertThat(inForce().version()).isEqualTo(2);
        assertThat(inForce().categories().get("outage").primary()).isEqualTo("ftp");
        assertThat(store.versions.get(1).appliedBy()).isEqualTo("file");
        // Once when the first policy was recorded at start, once for this edit.
        verify(audit, org.mockito.Mockito.times(2)).append(eq("file"), eq("policy.update"), isNull(), any());
    }

    @Test
    void aBrokenEditIsIgnoredAndTheWorkingPolicyStays() throws Exception {
        manager.bootstrap();
        Policy before = inForce();

        editFile(FILE.replace("primary: s3,  fallback: db", "primary: minio, fallback: db"), 2_000_000);
        manager.sync();
        manager.sync();

        assertThat(inForce()).isEqualTo(before);
        assertThat(store.versions).hasSize(1);
    }

    @Test
    void aHalfWrittenEditIsIgnoredToo() throws Exception {
        manager.bootstrap();

        editFile("version: 1\ncategories:\n  meter: { primary: d", 2_000_000);
        manager.sync();

        assertThat(inForce().version()).isEqualTo(1);
    }

    @Test
    void fixingABrokenFileAppliesTheFix() throws Exception {
        manager.bootstrap();
        editFile("not even yaml: [", 2_000_000);
        manager.sync();

        editFile(FILE.replace("queue: 200,", "queue: 250,"), 3_000_000);
        manager.sync();

        assertThat(inForce().version()).isEqualTo(2);
        assertThat(inForce().categories().get("document").queue()).isEqualTo(250);
    }

    @Test
    void anUnchangedFileDoesNothingOnEveryTick() {
        manager.bootstrap();

        manager.sync();
        manager.sync();
        manager.sync();

        assertThat(store.versions).hasSize(1);
        verify(audit, org.mockito.Mockito.times(1)).append(anyString(), anyString(), any(), any());
    }

    @Test
    void touchingTheFileWithoutChangingItRecordsNothing() throws Exception {
        manager.bootstrap();

        editFile(FILE, 2_000_000);
        manager.sync();

        assertThat(store.versions).hasSize(1);
    }

    @Test
    void aFileEditThatCannotBeRecordedYetIsTriedAgainOnTheNextTick() throws Exception {
        manager.bootstrap();
        editFile(FILE.replace("queue: 200,", "queue: 250,"), 2_000_000);
        doThrow(new IllegalStateException("db down")).when(audit).append(eq("file"), eq("policy.update"), any(), any());

        manager.sync();
        assertThat(inForce().version()).isEqualTo(1);

        org.mockito.Mockito.reset(audit);
        manager.sync();
        assertThat(inForce().version()).isEqualTo(2);
    }

    @Test
    void aMissingFileDoesNotBreakTheLoop() throws Exception {
        manager.bootstrap();
        Files.delete(file);

        manager.sync();
        manager.sync();

        assertThat(inForce().version()).isEqualTo(1);
        assertThat(store.versions).hasSize(1);
    }

    // ------------------------------------------------------------------ the change summary

    @Test
    void theChangeSummaryNamesEachDifferenceAndNothingElse() {
        Policy from = policy.current();
        Map<String, CategoryPolicy> cats = new java.util.LinkedHashMap<>(from.categories());
        CategoryPolicy doc = cats.get("document");
        cats.put("document", new CategoryPolicy(doc.primary(), "db", false, doc.maxSizeMb(), doc.priority(),
                doc.workers(), 300, doc.audit(), doc.chunkMb()));

        String text = PolicyService.describeChanges(from, new Policy(2, cats));

        assertThat(text).isEqualTo("document.fallback s3->db; document.encrypt true->false; document.queue 200->300");
        assertThat(PolicyService.describeChanges(from, from)).isEqualTo("no change");
    }

    // ------------------------------------------------------------------ helpers

    private Map<String, CategoryPolicy> withOutagePrimary(String primary) {
        Map<String, CategoryPolicy> cats = new java.util.LinkedHashMap<>(policy.current().categories());
        CategoryPolicy o = cats.get("outage");
        cats.put("outage", new CategoryPolicy(primary, o.fallback(), o.encrypt(), o.maxSizeMb(), o.priority(),
                o.workers(), o.queue(), o.audit(), o.chunkMb()));
        return cats;
    }

    /** The policy_versions table in memory. {@code down} makes every call fail, like a dead database. */
    private static final class MemoryStore implements PolicyStore {
        final List<PolicyVersion> versions = new ArrayList<>();
        boolean down;

        private void check() {
            if (down) {
                throw new IllegalStateException("database unavailable");
            }
        }

        @Override
        public void lock() {
            check();
        }

        @Override
        public Optional<PolicyVersion> latest() {
            check();
            return versions.stream().max(java.util.Comparator.comparingInt(PolicyVersion::version));
        }

        @Override
        public List<PolicyVersion> history(int limit) {
            check();
            return versions.stream().sorted(java.util.Comparator.comparingInt(PolicyVersion::version).reversed())
                    .limit(limit).toList();
        }

        @Override
        public void insert(PolicyVersion v) {
            check();
            if (versions.stream().anyMatch(x -> x.version() == v.version())) {
                throw new IllegalStateException("duplicate version");
            }
            versions.add(v);
        }
    }

    /** Runs the callback and, if it throws, puts the store back as it was: what a rolled-back transaction does. */
    private static final class RollbackTx extends TransactionTemplate {
        private final MemoryStore store;

        RollbackTx(MemoryStore store) {
            this.store = store;
        }

        @Override
        public <T> T execute(TransactionCallback<T> action) {
            List<PolicyVersion> snapshot = new ArrayList<>(store.versions);
            try {
                return action.doInTransaction(null);
            } catch (RuntimeException e) {
                store.versions.clear();
                store.versions.addAll(snapshot);
                throw e;
            }
        }
    }
}
