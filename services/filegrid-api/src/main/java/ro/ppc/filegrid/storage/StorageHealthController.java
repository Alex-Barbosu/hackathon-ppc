package ro.ppc.filegrid.storage;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * GET /api/v1/storages/health (contracts/openapi.yaml StorageHealth[]). Circuit state is
 * wired in the P2 resilience work; for now it reports a cheap liveness probe per backend.
 */
@RestController
@RequestMapping("/api/v1/storages")
public class StorageHealthController {

    private final StorageRegistry registry;

    public StorageHealthController(StorageRegistry registry) {
        this.registry = registry;
    }

    public record StorageHealth(String storage, boolean up, Double latencyMs, boolean circuitOpen) {}

    @GetMapping("/health")
    public List<StorageHealth> health() {
        return registry.all().stream().map(a -> {
            long start = System.nanoTime();
            boolean up = a.health();
            double ms = (System.nanoTime() - start) / 1_000_000.0;
            return new StorageHealth(a.kind().slug(), up, ms, false);
        }).toList();
    }
}
