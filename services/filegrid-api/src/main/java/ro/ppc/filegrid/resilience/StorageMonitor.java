package ro.ppc.filegrid.resilience;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;

/**
 * Probes each storage every few seconds and publishes {@code filegrid_storage_up}.
 *
 * <p>The probe goes through {@link StorageGuard}, so it counts like any other call. That is
 * what lets a circuit open and close with no traffic at all: a stopped storage trips its
 * circuit within a few probes, and once it returns, the first probe after the open wait is the
 * trial call that closes it. While a circuit is open the probe does not touch the backend.
 */
@Service
public class StorageMonitor {

    private static final List<Storage> MONITORED = List.of(Storage.DB, Storage.S3, Storage.FTP);

    /** What the last probe saw. */
    public record Snapshot(Storage storage, boolean up, double latencyMs, boolean circuitOpen) {
    }

    private record Probe(boolean up, double latencyMs) {
    }

    private final StorageRegistry registry;
    private final StorageGuard guard;
    private final Map<Storage, AtomicInteger> upGauges = new EnumMap<>(Storage.class);
    private final Map<Storage, Probe> last = new EnumMap<>(Storage.class);

    public StorageMonitor(StorageRegistry registry, StorageGuard guard, MeterRegistry meters) {
        this.registry = registry;
        this.guard = guard;
        for (Storage s : MONITORED) {
            // Assume up until the first probe says otherwise (it runs as soon as the app is ready).
            AtomicInteger up = new AtomicInteger(1);
            upGauges.put(s, up);
            Gauge.builder("filegrid.storage.up", up, AtomicInteger::get)
                    .description("1 if the last health probe of this storage succeeded")
                    .tag("storage", s.slug()).register(meters);
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void probeOnStartup() {
        probeAll();
    }

    @Scheduled(initialDelayString = "PT5S", fixedDelayString = "PT5S")
    public void probeAll() {
        for (Storage s : MONITORED) {
            probe(s);
        }
    }

    private void probe(Storage storage) {
        StorageAdapter adapter = registry.get(storage);
        long start = System.nanoTime();
        boolean up;
        try {
            guard.call(storage, () -> {
                if (!adapter.health()) {
                    throw new IllegalStateException("health probe failed");
                }
                return Boolean.TRUE;
            });
            up = true;
        } catch (RuntimeException e) {
            up = false;
        }
        double ms = (System.nanoTime() - start) / 1_000_000.0;
        synchronized (last) {
            last.put(storage, new Probe(up, ms));
        }
        upGauges.get(storage).set(up ? 1 : 0);
    }

    /** The last probe of each storage, plus the live circuit state. Probes once if none has run. */
    public List<Snapshot> snapshot() {
        boolean probed;
        synchronized (last) {
            probed = !last.isEmpty();
        }
        if (!probed) {
            probeAll();
        }
        List<Snapshot> out = new ArrayList<>();
        synchronized (last) {
            for (Storage s : MONITORED) {
                Probe p = last.get(s);
                out.add(new Snapshot(s, p != null && p.up(), p == null ? 0 : p.latencyMs(), guard.isTripped(s)));
            }
        }
        return out;
    }
}
