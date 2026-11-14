package ro.ppc.filegrid.policy;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ro.ppc.filegrid.auth.AuthFilter;
import ro.ppc.filegrid.auth.AuthPrincipal;

/**
 * The policy routes of contracts/openapi.yaml: {@code GET /policy}, {@code PUT /policy} (admin, applied
 * without a restart) and {@code GET /policy/history}. Who may PUT is decided in one place,
 * {@code AccessRules}, so a new route cannot forget it.
 */
@RestController
@RequestMapping("/api/v1/policy")
public class PolicyController {

    private final PolicyService policyService;
    private final PolicyManager manager;

    public PolicyController(PolicyService policyService, PolicyManager manager) {
        this.policyService = policyService;
        this.manager = manager;
    }

    @GetMapping
    public Policy current() {
        return policyService.current();
    }

    /**
     * The body is taken as raw JSON so the schema sees exactly what the client sent: an unknown key is
     * refused, not silently dropped. {@code version} in the body is ignored; the server numbers versions.
     */
    @PutMapping
    public Policy replace(@RequestBody JsonNode body,
                          @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) {
        return manager.apply(body, caller.username());
    }

    @GetMapping("/history")
    public List<PolicyVersion> history() {
        return manager.history();
    }
}
