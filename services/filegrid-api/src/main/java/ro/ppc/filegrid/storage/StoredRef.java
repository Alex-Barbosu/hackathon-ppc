package ro.ppc.filegrid.storage;

import ro.ppc.filegrid.domain.Storage;

/**
 * A handle to bytes that have been durably written. {@code key} is the object key/path
 * inside {@code storage}; {@code sizeBytes} is what the backend reports it stored.
 */
public record StoredRef(Storage storage, String key, long sizeBytes) {
}
