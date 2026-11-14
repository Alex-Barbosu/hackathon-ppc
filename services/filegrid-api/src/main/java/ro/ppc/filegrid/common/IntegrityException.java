package ro.ppc.filegrid.common;

import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;

/**
 * Thrown when the SHA-256 of the bytes read back differs from the recorded hash.
 * Carries category/storage so the handler can increment
 * {@code filegrid_integrity_failures_total{category,storage}} once, at the edge.
 */
public class IntegrityException extends RuntimeException {

    private final Category category;
    private final Storage storage;
    private final String expected;
    private final String actual;

    public IntegrityException(Category category, Storage storage, String expected, String actual) {
        super("integrity check failed: expected " + expected + " actual " + actual);
        this.category = category;
        this.storage = storage;
        this.expected = expected;
        this.actual = actual;
    }

    public Category category() {
        return category;
    }

    public Storage storage() {
        return storage;
    }

    public String expected() {
        return expected;
    }

    public String actual() {
        return actual;
    }
}
