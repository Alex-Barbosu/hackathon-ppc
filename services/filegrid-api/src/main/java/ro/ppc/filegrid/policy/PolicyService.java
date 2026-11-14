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

        Set<ValidationMessage> errors = schema.validate(node);
        if (!errors.isEmpty()) {
            List<String> problems = new ArrayList<>();
            for (ValidationMessage m : errors) {
                problems.add(m.getMessage());
            }
            problems.sort(String::compareTo);
            throw new PolicyValidationException(problems);
        }

        try {
            return json.treeToValue(node, Policy.class);
        } catch (IOException e) {
            throw new PolicyValidationException(List.of("policy shape unexpected: " + e.getMessage()));
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
