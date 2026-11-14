package ro.ppc.filegrid.policy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/** Unit tests for the policy loader: valid YAML routes, invalid YAML is rejected by the schema. */
class PolicyServiceTest {

    private static final String VALID = """
            version: 1
            categories:
              meter:    { primary: db,  fallback: spool, encrypt: false, maxSizeMb: 1,    priority: high,   workers: 16, queue: 5000 }
              outage:   { primary: s3,  fallback: db,    encrypt: false, maxSizeMb: 20,   priority: high,   workers: 8,  queue: 500 }
              document: { primary: ftp, fallback: s3,    encrypt: true,  maxSizeMb: 20,   priority: normal, workers: 4,  queue: 200, audit: true }
              video:    { primary: s3,  fallback: spool, encrypt: false, maxSizeMb: 5000, priority: low,    workers: 2,  queue: 20,  chunkMb: 16 }
            """;

    private PolicyService service;

    @BeforeEach
    void setUp(@TempDir Path dir) throws Exception {
        // Construct against a valid file so the schema loads; individual cases call loadAndValidate.
        Path file = dir.resolve("policy.yaml");
        Files.writeString(file, VALID);
        service = new PolicyService(file.toString());
    }

    @Test
    void routesEachCategoryToItsPrimary() {
        assertThat(service.primaryStorageFor(Category.METER)).isEqualTo(Storage.DB);
        assertThat(service.primaryStorageFor(Category.OUTAGE)).isEqualTo(Storage.S3);
        assertThat(service.primaryStorageFor(Category.DOCUMENT)).isEqualTo(Storage.FTP);
        assertThat(service.primaryStorageFor(Category.VIDEO)).isEqualTo(Storage.S3);
    }

    @Test
    void exposesFallbackAndFlags() {
        assertThat(service.fallbackStorageFor(Category.OUTAGE)).isEqualTo(Storage.DB);
        assertThat(service.policyFor(Category.DOCUMENT).encrypt()).isTrue();
        assertThat(service.policyFor(Category.DOCUMENT).auditEnabled()).isTrue();
        assertThat(service.current().version()).isEqualTo(1);
    }

    @Test
    void rejectsPrimaryOfSpool() {
        String bad = VALID.replace("primary: db,  fallback: spool", "primary: spool, fallback: db   ");
        assertThatThrownBy(() -> service.loadAndValidate(bad))
                .isInstanceOf(PolicyValidationException.class);
    }

    @Test
    void rejectsAFallbackThatIsThePrimary() {
        String bad = VALID.replace("primary: ftp, fallback: s3", "primary: s3,  fallback: s3");
        assertThat(bad).isNotEqualTo(VALID);

        assertThatThrownBy(() -> service.loadAndValidate(bad))
                .isInstanceOf(PolicyValidationException.class)
                .hasMessageContaining("fallback must differ from primary")
                .hasMessageContaining("categories.document.fallback");
    }

    @Test
    void everyCategoryWithTheSameFallbackIsNamed() throws Exception {
        var mapper = new com.fasterxml.jackson.dataformat.yaml.YAMLMapper();
        String bad = VALID.replace("primary: ftp, fallback: s3", "primary: s3,  fallback: s3")
                .replace("primary: s3,  fallback: db", "primary: db,  fallback: db");

        assertThatThrownBy(() -> service.validate(mapper.readTree(bad)))
                .isInstanceOfSatisfying(PolicyValidationException.class, e ->
                        assertThat(e.problems()).hasSize(2));
    }

    @Test
    void aSpoolFallbackForAnotherStorageIsStillFine() {
        assertThat(service.loadAndValidate(VALID).categories().get("meter").fallback()).isEqualTo("spool");
    }

    @Test
    void rejectsMissingCategory() {
        String bad = """
                version: 1
                categories:
                  meter:  { primary: db, fallback: spool, encrypt: false, maxSizeMb: 1, priority: high, workers: 16, queue: 5000 }
                """;
        assertThatThrownBy(() -> service.loadAndValidate(bad))
                .isInstanceOf(PolicyValidationException.class)
                .satisfies(e -> assertThat(((PolicyValidationException) e).problems()).isNotEmpty());
    }

    @Test
    void rejectsMissingRequiredField() {
        // Drop the required 'queue' from meter.
        String bad = VALID.replace(", queue: 5000 }", " }");
        assertThatThrownBy(() -> service.loadAndValidate(bad))
                .isInstanceOf(PolicyValidationException.class);
    }

    @Test
    void rejectsUnknownStorageValue() {
        String bad = VALID.replace("primary: s3,  fallback: db", "primary: minio, fallback: db");
        assertThatThrownBy(() -> service.loadAndValidate(bad))
                .isInstanceOf(PolicyValidationException.class);
    }

    @Test
    void rejectsNonInteger() {
        String bad = VALID.replace("version: 1", "version: notanumber");
        assertThatThrownBy(() -> service.loadAndValidate(bad))
                .isInstanceOf(PolicyValidationException.class);
    }

    @Test
    void aRequestBodyIsHeldToTheSameSchemaAsTheFile() throws Exception {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();

        assertThat(service.validate(new com.fasterxml.jackson.dataformat.yaml.YAMLMapper().readTree(VALID)).version()).isEqualTo(1);
        assertThatThrownBy(() -> service.validate(mapper.readTree("{\"version\":1}")))
                .isInstanceOf(PolicyValidationException.class);
        assertThatThrownBy(() -> service.validate(null)).isInstanceOf(PolicyValidationException.class);
        assertThatThrownBy(() -> service.validate(mapper.nullNode())).isInstanceOf(PolicyValidationException.class);
    }

    @Test
    void installSwapsThePolicyInUseAtOnce() {
        var changed = new Policy(7, service.current().categories());

        service.install(changed);

        assertThat(service.current().version()).isEqualTo(7);
        assertThat(service.primaryStorageFor(Category.OUTAGE)).isEqualTo(Storage.S3);
    }

    @Test
    void anAbsentAuditFlagReadsAsFalseAndAnUnsetChunkSizeStaysUnset() {
        assertThat(service.policyFor(Category.OUTAGE).audit()).isFalse();
        assertThat(service.policyFor(Category.OUTAGE).chunkMb()).isNull();
        assertThat(service.policyFor(Category.VIDEO).chunkMb()).isEqualTo(16);
        assertThat(service.policyFor(Category.DOCUMENT).auditEnabled()).isTrue();
    }
}
