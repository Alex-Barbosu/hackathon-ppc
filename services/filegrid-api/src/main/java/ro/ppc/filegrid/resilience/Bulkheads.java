package ro.ppc.filegrid.resilience;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;

/**
 * One bulkhead per category (backlog item 12): at most {@code workers} writes run at once, up to
 * {@code queue} more wait their turn, and anything beyond that is refused at once. So a storm in
 * one category fills only that category's queue; the others keep their own workers and answer as
 * usual.
 *
 * <p>The sizes come from the policy and are read on every entry, so an applied policy changes them
 * for the next request with no restart. A category's limits count what that category writes:
 * uploads, meter readings and each tus chunk. Downloads are not limited, because a long download of a
 * large file would otherwise hold one of a small category's workers for minutes.
 *
 * <p>This is a count of requests, not of threads: requests run on virtual threads, so a waiting
 * request costs almost nothing, and the limit is what protects storage and memory (each running tus
 * chunk holds one part buffer). The gauge {@code filegrid_queue_depth{category}} is the number waiting.
 */
@Service
public class Bulkheads {

    private static final Logger log = LoggerFactory.getLogger(Bulkheads.class);
    private static final long LOG_EVERY_MILLIS = 10_000;

    private final PolicyService policy;
    private final long maxWaitNanos;
    private final Map<Category, Limiter> limiters = new EnumMap<>(Category.class);
    private final Map<Category, AtomicLong> lastRejectionLog = new EnumMap<>(Category.class);

    @Autowired
    public Bulkheads(PolicyService policy, MeterRegistry registry,
                     @Value("${filegrid.bulkhead.max-wait-seconds:10}") long maxWaitSeconds) {
        this(policy, registry, Duration.ofSeconds(maxWaitSeconds));
    }

    public Bulkheads(PolicyService policy, MeterRegistry registry, Duration maxWait) {
        this.policy = policy;
        this.maxWaitNanos = maxWait.toNanos();
        for (Category c : Category.values()) {
            Limiter limiter = new Limiter();
            limiters.put(c, limiter);
            lastRejectionLog.put(c, new AtomicLong());
            // The name in contracts/metrics.md: items waiting in the category's queue.
            Gauge.builder("filegrid.queue.depth", limiter, Limiter::waiting)
                    .description("Requests waiting for a worker in this category's bulkhead")
                    .tag("category", c.slug()).register(registry);
        }
    }

    /** Held while one write runs. Closing it gives the worker back, also when the write failed. */
    public interface Permit extends AutoCloseable {
        @Override
        void close();
    }

    /**
     * Waits for a worker in {@code category}. Throws {@link BulkheadFullException} if the queue is
     * full (at once) or no worker frees up within the wait limit.
     */
    public Permit enter(Category category) {
        Limiter limiter = limiters.get(category);
        CategoryPolicy cp = policy.policyFor(category);
        limiter.configure(cp.workers(), cp.queue());

        Limiter.Outcome outcome;
        try {
            outcome = limiter.acquire(maxWaitNanos);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BulkheadFullException(category, BulkheadFullException.Reason.WAIT_TIMEOUT);
        }
        if (outcome != Limiter.Outcome.ACQUIRED) {
            logRejection(category, outcome);
            throw new BulkheadFullException(category, outcome == Limiter.Outcome.QUEUE_FULL
                    ? BulkheadFullException.Reason.QUEUE_FULL : BulkheadFullException.Reason.WAIT_TIMEOUT);
        }
        return limiter::release;
    }

    /** For tests and diagnostics: how many are running and waiting in a category right now. */
    public int running(Category category) {
        return limiters.get(category).running();
    }

    public int waiting(Category category) {
        return limiters.get(category).waiting();
    }

    private void logRejection(Category category, Limiter.Outcome outcome) {
        // A storm would write thousands of lines; one every few seconds says the same.
        AtomicLong last = lastRejectionLog.get(category);
        long now = System.currentTimeMillis();
        long before = last.get();
        if (now - before >= LOG_EVERY_MILLIS && last.compareAndSet(before, now)) {
            log.warn("category {} is at capacity ({}), refusing writes", category.slug(), outcome);
        }
    }

    /**
     * A counting limiter with a bounded queue and limits that can change while it runs. Built on a lock
     * and a condition, not {@code synchronized}, so a waiting virtual thread does not pin its carrier.
     */
    static final class Limiter {

        enum Outcome { ACQUIRED, QUEUE_FULL, TIMED_OUT }

        private final ReentrantLock lock = new ReentrantLock();
        private final Condition freed = lock.newCondition();
        private volatile int workers = 1;
        private volatile int queueCapacity = 0;
        private volatile int running;
        private volatile int waiting;

        void configure(int newWorkers, int newQueue) {
            if (newWorkers == workers && newQueue == queueCapacity) {
                return;
            }
            lock.lock();
            try {
                workers = Math.max(1, newWorkers);
                queueCapacity = Math.max(0, newQueue);
                freed.signalAll(); // more workers may let waiting requests in now
            } finally {
                lock.unlock();
            }
        }

        Outcome acquire(long maxWaitNanos) throws InterruptedException {
            lock.lockInterruptibly();
            try {
                if (running < workers && waiting == 0) {
                    running++;
                    return Outcome.ACQUIRED;
                }
                if (waiting >= queueCapacity) {
                    return Outcome.QUEUE_FULL;
                }
                waiting++;
                try {
                    long remaining = maxWaitNanos;
                    while (running >= workers) {
                        if (remaining <= 0) {
                            return Outcome.TIMED_OUT;
                        }
                        remaining = freed.awaitNanos(remaining);
                    }
                    running++;
                    return Outcome.ACQUIRED;
                } finally {
                    waiting--;
                }
            } finally {
                lock.unlock();
            }
        }

        void release() {
            lock.lock();
            try {
                running--;
                freed.signal();
            } finally {
                lock.unlock();
            }
        }

        int waiting() {
            return waiting;
        }

        int running() {
            return running;
        }
    }
}
