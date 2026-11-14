package ro.ppc.filegrid.resilience;

import ro.ppc.filegrid.domain.Storage;

/**
 * A storage could not be used: its circuit is open, or the call to it failed. Callers decide
 * what that means: a write moves to the policy's fallback, a read becomes a 503.
 */
public class StorageDownException extends RuntimeException {

    private final transient Storage storage;
    private final boolean circuitOpen;

    public StorageDownException(Storage storage, boolean circuitOpen, Throwable cause) {
        super("storage " + storage.slug() + " unavailable" + (circuitOpen ? " (circuit open)" : ""), cause);
        this.storage = storage;
        this.circuitOpen = circuitOpen;
    }

    public Storage storage() {
        return storage;
    }

    /** True when the call was refused without trying: the backend was not touched. */
    public boolean circuitOpen() {
        return circuitOpen;
    }
}
