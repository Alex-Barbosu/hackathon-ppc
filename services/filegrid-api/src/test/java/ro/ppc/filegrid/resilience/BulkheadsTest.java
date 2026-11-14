package ro.ppc.filegrid.resilience;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.policy.CategoryPolicy;
import ro.ppc.filegrid.policy.PolicyService;

/** The limits themselves: concurrency, the queue, isolation between categories, and changing them live. */
class BulkheadsTest {

    private PolicyService policy;
    private SimpleMeterRegistry registry;
    private Bulkheads bulkheads;

    private static CategoryPolicy limits(int workers, int queue) {
        return new CategoryPolicy("s3", "db", false, 20, "high", workers, queue, false, null);
    }

    @BeforeEach
    void setUp() {
        policy = mock(PolicyService.class);
        registry = new SimpleMeterRegistry();
        when(policy.policyFor(Category.OUTAGE)).thenReturn(limits(2, 4));
        when(policy.policyFor(Category.METER)).thenReturn(limits(16, 5000));
        when(policy.policyFor(Category.DOCUMENT)).thenReturn(limits(4, 200));
        when(policy.policyFor(Category.VIDEO)).thenReturn(limits(2, 20));
        bulkheads = new Bulkheads(policy, registry, Duration.ofSeconds(5));
    }

    private double queueDepth(Category c) {
        return registry.get("filegrid.queue.depth").tag("category", c.slug()).gauge().value();
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Waits until {@code condition} is true; fails the test after a few seconds. */
    private static void eventually(java.util.function.BooleanSupplier condition) {
        long deadline = System.currentTimeMillis() + 5000;
        while (!condition.getAsBoolean()) {
            if (System.currentTimeMillis() > deadline) {
                throw new AssertionError("condition not reached in time");
            }
            sleep(5);
        }
    }

    @Test
    void neverMoreThanTheWorkersRunAtOnce() throws Exception {
        AtomicInteger now = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        CountDownLatch done = new CountDownLatch(6);
        for (int i = 0; i < 6; i++) {
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                    peak.accumulateAndGet(now.incrementAndGet(), Math::max);
                    sleep(60);
                    now.decrementAndGet();
                } finally {
                    done.countDown();
                }
            });
        }

        assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(peak).as("outage has 2 workers").hasValue(2);
    }

    @Test
    void requestsBeyondTheWorkersWaitInTheQueueAndAllRunInTheEnd() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger finished = new AtomicInteger();
        for (int i = 0; i < 6; i++) { // 2 run, 4 wait: exactly the queue
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                    release.await();
                    finished.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        eventually(() -> bulkheads.waiting(Category.OUTAGE) == 4);

        assertThat(bulkheads.running(Category.OUTAGE)).isEqualTo(2);
        assertThat(queueDepth(Category.OUTAGE)).as("filegrid_queue_depth").isEqualTo(4.0);

        release.countDown();
        eventually(() -> finished.get() == 6);
        assertThat(queueDepth(Category.OUTAGE)).isZero();
        assertThat(bulkheads.running(Category.OUTAGE)).isZero();
    }

    @Test
    void whenTheQueueIsFullTheNextRequestIsRefusedAtOnce() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        for (int i = 0; i < 6; i++) {
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        eventually(() -> bulkheads.waiting(Category.OUTAGE) == 4);

        long start = System.nanoTime();
        assertThatThrownBy(() -> bulkheads.enter(Category.OUTAGE))
                .isInstanceOfSatisfying(BulkheadFullException.class, e -> {
                    assertThat(e.category()).isEqualTo(Category.OUTAGE);
                    assertThat(e.reason()).isEqualTo(BulkheadFullException.Reason.QUEUE_FULL);
                });
        assertThat(Duration.ofNanos(System.nanoTime() - start)).as("it did not wait").isLessThan(Duration.ofMillis(500));
        release.countDown();
    }

    @Test
    void aStormInOneCategoryDoesNotTouchTheOthers() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        for (int i = 0; i < 6; i++) { // fill outage completely
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        eventually(() -> bulkheads.waiting(Category.OUTAGE) == 4);
        assertThatThrownBy(() -> bulkheads.enter(Category.OUTAGE)).isInstanceOf(BulkheadFullException.class);

        for (Category other : new Category[] {Category.METER, Category.DOCUMENT, Category.VIDEO}) {
            long start = System.nanoTime();
            try (Bulkheads.Permit p = bulkheads.enter(other)) {
                assertThat(Duration.ofNanos(System.nanoTime() - start)).as(other.slug() + " enters at once")
                        .isLessThan(Duration.ofMillis(200));
            }
            assertThat(queueDepth(other)).isZero();
        }
        release.countDown();
    }

    @Test
    void aRequestThatWaitsTooLongIsRefusedWithATimeout() throws Exception {
        Bulkheads quick = new Bulkheads(policy, new SimpleMeterRegistry(), Duration.ofMillis(150));
        CountDownLatch release = new CountDownLatch(1);
        for (int i = 0; i < 2; i++) {
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = quick.enter(Category.OUTAGE)) {
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        eventually(() -> quick.running(Category.OUTAGE) == 2);

        assertThatThrownBy(() -> quick.enter(Category.OUTAGE)).isInstanceOfSatisfying(BulkheadFullException.class,
                e -> assertThat(e.reason()).isEqualTo(BulkheadFullException.Reason.WAIT_TIMEOUT));
        assertThat(quick.waiting(Category.OUTAGE)).as("and it no longer counts as waiting").isZero();
        release.countDown();
    }

    @Test
    void theWorkerIsGivenBackEvenWhenTheWorkFails() {
        for (int i = 0; i < 10; i++) {
            try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                throw new IllegalStateException("the write failed");
            } catch (IllegalStateException expected) {
                // each failure must still release its worker
            }
        }

        assertThat(bulkheads.running(Category.OUTAGE)).isZero();
        try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
            assertThat(bulkheads.running(Category.OUTAGE)).isEqualTo(1);
        }
    }

    @Test
    void anAppliedPolicyChangesTheLimitsWithoutARestart() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger running = new AtomicInteger();
        for (int i = 0; i < 4; i++) { // 2 run, 2 wait
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                    running.incrementAndGet();
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        eventually(() -> running.get() == 2 && bulkheads.waiting(Category.OUTAGE) == 2);

        // "Apply policy": outage now has 4 workers. The next request to arrive sees the new limits, and the
        // two that were waiting start with it. A fifth request is the one left waiting.
        when(policy.policyFor(Category.OUTAGE)).thenReturn(limits(4, 4));
        Thread.ofVirtual().start(() -> {
            try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                running.incrementAndGet();
                release.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        eventually(() -> running.get() == 4);
        assertThat(bulkheads.running(Category.OUTAGE)).isEqualTo(4);
        assertThat(bulkheads.waiting(Category.OUTAGE)).isEqualTo(1);
        release.countDown();
    }

    @Test
    void aQueueOfZeroMeansNoWaitingAtAll() {
        when(policy.policyFor(Category.VIDEO)).thenReturn(limits(1, 0));

        try (Bulkheads.Permit held = bulkheads.enter(Category.VIDEO)) {
            assertThatThrownBy(() -> bulkheads.enter(Category.VIDEO)).isInstanceOfSatisfying(BulkheadFullException.class,
                    e -> assertThat(e.reason()).isEqualTo(BulkheadFullException.Reason.QUEUE_FULL));
        }
        try (Bulkheads.Permit again = bulkheads.enter(Category.VIDEO)) {
            assertThat(bulkheads.running(Category.VIDEO)).isEqualTo(1);
        }
    }

    @Test
    void aWaiterThatIsInterruptedGivesUpCleanly() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        for (int i = 0; i < 2; i++) {
            Thread.ofVirtual().start(() -> {
                try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                    release.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        eventually(() -> bulkheads.running(Category.OUTAGE) == 2);
        AtomicInteger refused = new AtomicInteger();
        Thread waiter = Thread.ofVirtual().start(() -> {
            try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                // never gets here
            } catch (BulkheadFullException e) {
                refused.incrementAndGet();
            }
        });
        eventually(() -> bulkheads.waiting(Category.OUTAGE) == 1);

        waiter.interrupt();
        waiter.join(2000);

        assertThat(refused).hasValue(1);
        assertThat(bulkheads.waiting(Category.OUTAGE)).isZero();
        release.countDown();
    }

    @Test
    void manyRequestsAtOnceAllGetThroughOrAreRefusedNoneAreLost() throws Exception {
        // 200 arrive together at a category with 2 workers and a queue of 4: some run, the rest are refused.
        AtomicInteger ran = new AtomicInteger();
        AtomicInteger refused = new AtomicInteger();
        List<Thread> threads = new ArrayList<>();
        CountDownLatch start = new CountDownLatch(1);
        for (int i = 0; i < 200; i++) {
            threads.add(Thread.ofVirtual().start(() -> {
                try {
                    start.await();
                    try (Bulkheads.Permit p = bulkheads.enter(Category.OUTAGE)) {
                        sleep(10);
                        ran.incrementAndGet();
                    }
                } catch (BulkheadFullException e) {
                    refused.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }));
        }
        start.countDown();
        for (Thread t : threads) {
            t.join(10_000);
        }

        assertThat(ran.get() + refused.get()).isEqualTo(200);
        assertThat(ran.get()).isGreaterThanOrEqualTo(6);
        assertThat(refused.get()).as("a burst beyond workers + queue is refused, not queued forever").isGreaterThan(0);
        assertThat(bulkheads.running(Category.OUTAGE)).isZero();
        assertThat(bulkheads.waiting(Category.OUTAGE)).isZero();
    }
}
