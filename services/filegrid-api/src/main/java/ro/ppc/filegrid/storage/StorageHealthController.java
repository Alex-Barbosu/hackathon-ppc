package ro.ppc.filegrid.storage;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ro.ppc.filegrid.resilience.StorageMonitor;

/**
 * GET /api/v1/storages/health (contracts/openapi.yaml StorageHealth[]): the last probe of each
 * backend and the live state of its circuit. It reads the monitor's result and never calls a
 * backend itself, so a page polling this cannot add load to a storage that is struggling.
 */
@RestController
@RequestMapping("/api/v1/storages")
public class StorageHealthController {

    private final StorageMonitor monitor;

    public StorageHealthController(StorageMonitor monitor) {
        this.monitor = monitor;
    }

    public record StorageHealth(String storage, boolean up, Double latencyMs, boolean circuitOpen) {}

    @GetMapping("/health")
    public List<StorageHealth> health() {
        return monitor.snapshot().stream()
                .map(s -> new StorageHealth(s.storage().slug(), s.up(), s.latencyMs(), s.circuitOpen()))
                .toList();
    }
}
