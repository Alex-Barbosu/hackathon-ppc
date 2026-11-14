package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.networknt.schema.InputFormat;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/**
 * Loads config/policy.yaml (path from FILEGRID_POLICY_FILE), validates it against the
 * bundled copy of contracts/policy.schema.json, and answers routing questions. Routing is
 * data-driven: changing storage per category is a file edit, never a code change
 * (gating requirement 3).
 */
@Service
public class PolicyService {

    private static final Logger log = LoggerFactory.getLogger(PolicyService.class);

    private final Path policyFile;
    private final YAMLMapper yaml = new YAMLMapper();
    private final ObjectMapper json = new ObjectMapper();
    private final JsonSchema schema;

    private volatile Policy current;

    public PolicyService(@Value("${filegrid.policy-file:/config/policy.yaml}") String policyFilePath) {
        this.policyFile = Path.of(policyFilePath);
        this.schema = loadSchema();
        reload();
    }

    /** Re-read and re-validate the file. Used at startup and by the hot-reload path (P1). */
    public final synchronized void reload() {
        try {
            String rawYaml = Files.readString(policyFile);
            this.current = loadAndValidate(rawYaml);
            log.info("policy loaded version={} path={}", current.version(), policyFile);
        } catch (IOException e) {
            throw new IllegalStateException("cannot read policy file " + policyFile, e);
        }
    }

    /**
     * Parse YAML, convert to JSON, validate against the schema, and map to the Policy record.
     * Package-private and pure so unit tests can exercise it without a file on disk.
     */
    Policy loadAndValidate(String rawYaml) {
        JsonNode node;
        try {
            node = yaml.readTree(rawYaml);
        } catch (IOException e) {
            throw new PolicyValidationException(List.of("not valid YAML: " + e.getMessage()));
        }
        if (node == null || node.isMissingNode()) {
            throw new PolicyValidationException(List.of("policy document is empty"));
        }

        return validate(node);
    }

    /**
     * Checks a policy document against the schema and maps it. Used for the file and for
     * {@code PUT /policy}, so both are held to exactly the same rules (unknown keys, a missing
     * category, a {@code spool} primary and wrong types are all refused).
     */
    public Policy validate(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            throw new PolicyValidationException(List.of("policy document is empty"));
        }
        Set<ValidationMessage> errors = schema.validate(node);
        if (!errors.isEmpty()) {
            List<String> problems = new ArrayList<>();
            for (ValidationMessage m : errors) {
                problems.add(m.getMessage());
            }
            problems.sort(String::compareTo);
            throw new PolicyValidationException(problems);
        }

        // The schema cannot compare two fields. A fallback that is the primary is no fallback: the write would
        // fail again on the same storage. (It also goes for the file, so a hand edit is held to the same rule.)
        List<String> same = new ArrayList<>();
        node.path("categories").fields().forEachRemaining(e -> {
            String primary = e.getValue().path("primary").asText(null);
            if (primary != null && primary.equals(e.getValue().path("fallback").asText(null))) {
                same.add("$.categories." + e.getKey() + ".fallback: fallback must differ from primary");
            }
        });
        if (!same.isEmpty()) {
            same.sort(String::compareTo);
            throw new PolicyValidationException(same);
        }

        try {
            return json.treeToValue(node, Policy.class);
        } catch (IOException e) {
            throw new PolicyValidationException(List.of("policy shape unexpected: " + e.getMessage()));
        }
    }

    /** Parses and validates YAML text, the format of config/policy.yaml. */
    public Policy parseYaml(String rawYaml) {
        return loadAndValidate(rawYaml);
    }

    /** Replaces the policy in use. One volatile write, so a request sees either the old or the new one, never a mix. */
    public void install(Policy policy) {
        Policy previous = this.current;
        this.current = policy;
        if (previous == null || previous.version() != policy.version()) {
            log.info("policy in use is now version={}", policy.version());
        }
    }

    public Path policyFile() {
        return policyFile;
    }

    /**
     * A short, readable list of what differs, for the audit log. Only values of the policy
     * itself (storages, flags, sizes): nothing about any file or person.
     */
    public static String describeChanges(Policy from, Policy to) {
        List<String> changes = new ArrayList<>();
        for (String category : to.categories().keySet()) {
            CategoryPolicy a = from.categories().get(category);
            CategoryPolicy b = to.categories().get(category);
            if (b.equals(a)) {
                continue;
            }
            if (a == null) {
                changes.add(category + " added");
                continue;
            }
            diff(changes, category, "primary", a.primary(), b.primary());
            diff(changes, category, "fallback", a.fallback(), b.fallback());
            diff(changes, category, "encrypt", a.encrypt(), b.encrypt());
            diff(changes, category, "audit", a.audit(), b.audit());
            diff(changes, category, "maxSizeMb", a.maxSizeMb(), b.maxSizeMb());
            diff(changes, category, "priority", a.priority(), b.priority());
            diff(changes, category, "workers", a.workers(), b.workers());
            diff(changes, category, "queue", a.queue(), b.queue());
            diff(changes, category, "chunkMb", a.chunkMb(), b.chunkMb());
        }
        String text = changes.isEmpty() ? "no change" : String.join("; ", changes);
        return text.length() > 480 ? text.substring(0, 480) : text;
    }

    private static void diff(List<String> out, String category, String field, Object before, Object after) {
        if (!java.util.Objects.equals(before, after)) {
            out.add(category + "." + field + " " + before + "->" + after);
        }
    }

    public Policy current() {
        return current;
    }

    public CategoryPolicy policyFor(Category category) {
        CategoryPolicy p = current.categories().get(category.slug());
        if (p == null) {
            throw new PolicyValidationException(List.of("no policy for category " + category.slug()));
        }
        return p;
    }

    /** The backend a category is written to first. */
    public Storage primaryStorageFor(Category category) {
        return policyFor(category).primaryStorage();
    }

    public Storage fallbackStorageFor(Category category) {
        return policyFor(category).fallbackStorage();
    }

    private JsonSchema loadSchema() {
        JsonSchemaFactory factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012);
        try (InputStream in = getClass().getResourceAsStream("/policy.schema.json")) {
            if (in == null) {
                throw new IllegalStateException("bundled policy.schema.json not found on classpath");
            }
            return factory.getSchema(in);
        } catch (IOException e) {
            throw new IllegalStateException("cannot load policy schema", e);
        }
    }
}
