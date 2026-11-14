package ro.ppc.filegrid.resilience;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
import java.util.EnumMap;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;

/**
 * Probes each storage every 2 seconds and publishes {@code filegrid_storage_up}.
 *
 * <p>The probes run side by side and each gets {@value #PROBE_TIMEOUT_MS} ms: one that has not answered by then
 * counts as down. A storage that hangs (an S3 that is paused, a dead network) therefore cannot hold up the
 * others or the page that reads {@code /storages/health}, which only ever returns the last result (at most about
 * 3 seconds old) and never calls a backend itself. A probe that is still stuck is not started again.
 *
 * <p>The probe goes through {@link StorageGuard}, so it counts like any other call. That is
 * what lets a circuit open and close with no traffic at all: a stopped storage trips its
 * circuit within a few probes, and once it returns, the first probe after the open wait is the
 * trial call that closes it. While a circuit is open the probe does not touch the backend.
 */
@Service
public class StorageMonitor {

    static final long PROBE_TIMEOUT_MS = 1000;
    private static final Duration PROBE_TIMEOUT = Duration.ofMillis(PROBE_TIMEOUT_MS);

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
    private final Map<Storage, AtomicBoolean> running = new EnumMap<>(Storage.class);
    private final ExecutorService probeThreads = Executors.newVirtualThreadPerTaskExecutor();

    public StorageMonitor(StorageRegistry registry, StorageGuard guard, MeterRegistry meters) {
        this.registry = registry;
        this.guard = guard;
        for (Storage s : MONITORED) {
            // Assume up until the first probe says otherwise (it runs as soon as the app is ready).
            AtomicInteger up = new AtomicInteger(1);
            upGauges.put(s, up);
            running.put(s, new AtomicBoolean());
            Gauge.builder("filegrid.storage.up", up, AtomicInteger::get)
                    .description("1 if the last health probe of this storage succeeded")
                    .tag("storage", s.slug()).register(meters);
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void probeOnStartup() {
        probeAll();
    }

    @Scheduled(initialDelayString = "PT2S", fixedDelayString = "PT2S")
    public void probeAll() {
        Map<Storage, Future<Probe>> started = new EnumMap<>(Storage.class);
        for (Storage s : MONITORED) {
            started.put(s, start(s));
        }
        long deadline = System.nanoTime() + PROBE_TIMEOUT.toNanos();
        for (Storage s : MONITORED) {
            Probe p = await(started.get(s), deadline);
            synchronized (last) {
                last.put(s, p);
            }
            upGauges.get(s).set(p.up() ? 1 : 0);
        }
    }

    /** Starts a probe, unless the last one of this storage is still stuck: then there is nothing to wait for. */
    private Future<Probe> start(Storage storage) {
        AtomicBoolean busy = running.get(storage);
        if (!busy.compareAndSet(false, true)) {
            return null;
        }
        return probeThreads.submit(() -> {
            try {
                return probe(storage);
            } finally {
                busy.set(false);
            }
        });
    }

    private static Probe await(Future<Probe> probe, long deadlineNanos) {
        Probe timedOut = new Probe(false, PROBE_TIMEOUT_MS);
        if (probe == null) {
            return timedOut;
        }
        try {
            return probe.get(Math.max(0, deadlineNanos - System.nanoTime()), TimeUnit.NANOSECONDS);
        } catch (TimeoutException e) {
            probe.cancel(true);
            return timedOut;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return timedOut;
        } catch (Exception e) {
            return timedOut;
        }
    }

    private Probe probe(Storage storage) {
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
        return new Probe(up, (System.nanoTime() - start) / 1_000_000.0);
    }

    @PreDestroy
    void stop() {
        probeThreads.shutdownNow();
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
