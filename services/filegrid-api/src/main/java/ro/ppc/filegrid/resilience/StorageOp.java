package ro.ppc.filegrid.resilience;

/** One call to a storage backend, which may throw anything a driver can throw. */
@FunctionalInterface
public interface StorageOp<T> {
    T run() throws Exception;
}
