package ro.ppc.filegrid.resilience;

import ro.ppc.filegrid.domain.Category;

/**
 * A category is at capacity: all its workers are busy and its queue is full, or the wait for a
 * worker ran out. Only this category is refused; the others are untouched. The answer is a 503 with
 * Retry-After, which tus clients and the meter simulator already retry on their own.
 */
public class BulkheadFullException extends RuntimeException {

    public enum Reason { QUEUE_FULL, WAIT_TIMEOUT }

    private final transient Category category;
    private final Reason reason;

    public BulkheadFullException(Category category, Reason reason) {
        super("category " + category.slug() + " is at capacity, try again shortly");
        this.category = category;
        this.reason = reason;
    }

    public Category category() {
        return category;
    }

    public Reason reason() {
        return reason;
    }
}
