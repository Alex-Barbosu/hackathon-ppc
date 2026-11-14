package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/** The whole policy document: a version and the four category entries. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Policy(int version, Map<String, CategoryPolicy> categories) {
}
