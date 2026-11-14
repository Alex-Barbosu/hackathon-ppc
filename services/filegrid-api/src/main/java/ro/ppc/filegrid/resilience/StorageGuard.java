package ro.ppc.filegrid.resilience;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Storage;

/**
 * One circuit breaker per storage (db, s3, ftp). Every call to a backend goes through
 * {@link #call}, so after a few failures FileGrid stops calling a dead backend, answers at
 * once, and routes writes to the policy's fallback. After a wait it lets a couple of calls
 * through; if they succeed the circuit closes again.
 *
 * <p>What does not count as a storage failure: the client's connection breaking
 * ({@link ClientStreamException}), a refusal FileGrid made itself ({@link ApiException}), and
 * data the database rejects as invalid ({@link DataIntegrityViolationException}). Retrying
 * those elsewhere would not help, and counting them would let one bad client open a circuit.
 *
 * <p>The spool is local disk and has no circuit.
 */
@Service
public class StorageGuard {

    private static final Logger log = LoggerFactory.getLogger(StorageGuard.class);

    private final Map<Storage, CircuitBreaker> breakers = new EnumMap<>(Storage.class);

    @Autowired
    public StorageGuard(MeterRegistry registry,
                        @Value("${filegrid.breaker.window:10}") int window,
                        @Value("${filegrid.breaker.min-calls:3}") int minCalls,
                        @Value("${filegrid.breaker.failure-rate:50}") float failureRate,
                        @Value("${filegrid.breaker.open-seconds:10}") long openSeconds) {
        CircuitBreakerConfig config = CircuitBreakerConfig.custom()
                .slidingWindowType(CircuitBreakerConfig.SlidingWindowType.COUNT_BASED)
                .slidingWindowSize(window)
                .minimumNumberOfCalls(minCalls)
                .failureRateThreshold(failureRate)
                .waitDurationInOpenState(Duration.ofSeconds(openSeconds))
                .permittedNumberOfCallsInHalfOpenState(2)
                .automaticTransitionFromOpenToHalfOpenEnabled(true)
                .build();
        for (Storage s : List.of(Storage.DB, Storage.S3, Storage.FTP)) {
            CircuitBreaker cb = CircuitBreaker.of(s.slug(), config);
            cb.getEventPublisher().onStateTransition(e ->
                    log.warn("circuit for {} is now {}", s.slug(), e.getStateTransition().getToState()));
            breakers.put(s, cb);
            // 1 until the circuit is fully closed again, the name in contracts/metrics.md. Half-open counts
            // as 1: it only means a trial call is allowed, and a storage that is still down would otherwise
            // flip between 1 and 0 every time the wait ends.
            Gauge.builder("filegrid.circuit.open", cb, c -> c.getState() == CircuitBreaker.State.CLOSED ? 0 : 1)
                    .description("1 while filegrid-api does not trust this storage (open or half-open)")
                    .tag("storage", s.slug()).register(registry);
        }
    }

    /**
     * Runs {@code op} against {@code storage}. Throws {@link StorageDownException} if the circuit
     * is open (the op is not run) or the op fails in a way that counts.
     */
    public <T> T call(Storage storage, StorageOp<T> op) {
        CircuitBreaker cb = breakers.get(storage);
        if (cb == null) {
            throw new IllegalArgumentException("no circuit for " + storage.slug());
        }
        if (!cb.tryAcquirePermission()) {
            throw new StorageDownException(storage, true, null);
        }
        long start = System.nanoTime();
        try {
            T result = op.run();
            cb.onSuccess(System.nanoTime() - start, TimeUnit.NANOSECONDS);
            return result;
        } catch (Exception e) {
            if (ignored(e)) {
                cb.releasePermission();
                if (e instanceof RuntimeException re) {
                    throw re;
                }
            }
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            cb.onError(System.nanoTime() - start, TimeUnit.NANOSECONDS, e);
            throw new StorageDownException(storage, false, e);
        }
    }

    /** False while the circuit is open, so a caller can skip a backend it knows is down. */
    public boolean allows(Storage storage) {
        CircuitBreaker cb = breakers.get(storage);
        return cb == null || !isRefusing(cb.getState());
    }

    public boolean isOpen(Storage storage) {
        return !allows(storage);
    }

    /**
     * True until the circuit is fully closed: open, or half-open and still on trial. This is what
     * is shown to people (the gauge, /storages/health); {@link #allows} is what code uses to decide
     * whether to call, and lets a trial call through while half-open.
     */
    public boolean isTripped(Storage storage) {
        CircuitBreaker cb = breakers.get(storage);
        return cb != null && cb.getState() != CircuitBreaker.State.CLOSED;
    }

    CircuitBreaker breaker(Storage storage) {
        return breakers.get(storage);
    }

    private static boolean isRefusing(CircuitBreaker.State state) {
        return state == CircuitBreaker.State.OPEN || state == CircuitBreaker.State.FORCED_OPEN;
    }

    private static boolean ignored(Exception e) {
        return e instanceof ClientStreamException
                || e instanceof ApiException
                || e instanceof DataIntegrityViolationException;
    }
}
