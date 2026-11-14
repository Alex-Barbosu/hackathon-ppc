package ro.ppc.filegrid.tus;

import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Keeps each running SHA-256 on the instance that is receiving the upload, so the hash is
 * computed while the bytes stream in. A digest cannot be saved to the database, so if the
 * next chunk lands on another replica (or after a restart) the cache has no usable entry and
 * the service falls back to hashing the finished object once. An entry is only usable when
 * it has consumed exactly the bytes below the upload's offset, and {@link #take} removes it,
 * so a request that fails midway leaves nothing stale behind.
 */
final class DigestCache {

    private static final int MAX_ENTRIES = 512;

    record Entry(MessageDigest digest, long offset) {
    }

    private final Map<UUID, Entry> entries = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<UUID, Entry> eldest) {
            return size() > MAX_ENTRIES;
        }
    };

    /** Removes and returns the digest if it covers exactly {@code offset} bytes; otherwise null. */
    synchronized MessageDigest take(UUID id, long offset) {
        Entry e = entries.remove(id);
        return e != null && e.offset() == offset ? e.digest() : null;
    }

    synchronized void put(UUID id, MessageDigest digest, long offset) {
        entries.put(id, new Entry(digest, offset));
    }

    synchronized void drop(UUID id) {
        entries.remove(id);
    }
}
