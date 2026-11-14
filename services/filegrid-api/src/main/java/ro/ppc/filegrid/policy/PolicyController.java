package ro.ppc.filegrid.policy;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Contract: GET /api/v1/policy -> Policy (contracts/openapi.yaml). PUT is P1. */
@RestController
@RequestMapping("/api/v1/policy")
public class PolicyController {

    private final PolicyService policyService;

    public PolicyController(PolicyService policyService) {
        this.policyService = policyService;
    }

    @GetMapping
    public Policy current() {
        return policyService.current();
    }
}
