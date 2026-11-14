package ro.ppc.filegrid.storage;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Storage;

/** Looks up the adapter for a {@link Storage} value chosen by the policy. */
@Component
public class StorageRegistry {

    private final Map<Storage, StorageAdapter> byKind = new EnumMap<>(Storage.class);

    public StorageRegistry(List<StorageAdapter> adapters) {
        for (StorageAdapter a : adapters) {
            byKind.put(a.kind(), a);
        }
    }

    public StorageAdapter get(Storage storage) {
        StorageAdapter a = byKind.get(storage);
        if (a == null) {
            throw ApiException.storageUnavailable("no adapter for storage " + storage.slug());
        }
        return a;
    }

    public List<StorageAdapter> all() {
        return List.copyOf(byKind.values());
    }
}
