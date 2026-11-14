package ro.ppc.filegrid.health;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Contract: GET /api/v1/health -> Health (contracts/openapi.yaml).
 * Kept separate from /actuator/health because the gateway exposes only /api/*,
 * and Caddy uses this route to decide which replicas receive traffic.
 */
@RestController
@RequestMapping("/api/v1")
public class HealthController {

    private final String version;

    public HealthController(@Value("${filegrid.version:0.1.0}") String version) {
        this.version = version;
    }

    @GetMapping("/health")
    public Health health() {
        return new Health("up", "filegrid-api", version);
    }

    public record Health(String status, String service, String version) {}
}
