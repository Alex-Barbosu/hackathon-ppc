package ro.ppc.filegrid.policy;

import java.util.List;

/** The policy file did not satisfy contracts/policy.schema.json. */
public class PolicyValidationException extends RuntimeException {

    private final List<String> problems;

    public PolicyValidationException(List<String> problems) {
        super("policy failed schema validation: " + String.join("; ", problems));
        this.problems = List.copyOf(problems);
    }

    public List<String> problems() {
        return problems;
    }
}
