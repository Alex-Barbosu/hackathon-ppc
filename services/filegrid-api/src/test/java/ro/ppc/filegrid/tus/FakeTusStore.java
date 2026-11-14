package ro.ppc.filegrid.tus;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import ro.ppc.filegrid.files.FileRow;

/** In-memory {@link TusStore} with the same compare-and-set rule as the SQL one. */
final class FakeTusStore implements TusStore {

    final Map<UUID, TusUpload> uploads = new HashMap<>();
    final Map<UUID, TreeMap<Integer, String>> parts = new HashMap<>();
    final Map<UUID, FileRow> files = new HashMap<>();

    @Override
    public void insert(TusUpload u) {
        uploads.put(u.id(), u);
    }

    @Override
    public Optional<TusUpload> find(UUID id) {
        return Optional.ofNullable(uploads.get(id));
    }

    @Override
    public boolean advance(UUID id, long expectedOffset, long newOffset, long busyMsDelta) {
        TusUpload u = uploads.get(id);
        if (u == null || u.completed() || u.offset() != expectedOffset) {
            return false;
        }
        uploads.put(id, copy(u, newOffset, u.busyMs() + busyMsDelta, null));
        return true;
    }

    @Override
    public void putPart(UUID id, int partNumber, String etag) {
        parts.computeIfAbsent(id, k -> new TreeMap<>()).put(partNumber, etag);
    }

    @Override
    public List<PartRef> parts(UUID id) {
        List<PartRef> out = new ArrayList<>();
        parts.getOrDefault(id, new TreeMap<>()).forEach((n, e) -> out.add(new PartRef(n, e)));
        return out;
    }

    @Override
    public void complete(UUID id, FileRow file, long busyMsDelta) {
        files.put(id, file);
        TusUpload u = uploads.get(id);
        uploads.put(id, copy(u, u.length(), u.busyMs() + busyMsDelta, Instant.now()));
    }

    /** The cutoff is ignored: tests treat every upload as idle. */
    @Override
    public List<TusUpload> findIdleSince(Instant cutoff) {
        return new ArrayList<>(uploads.values());
    }

    @Override
    public void delete(UUID id) {
        uploads.remove(id);
        parts.remove(id);
    }

    private static TusUpload copy(TusUpload u, long offset, long busyMs, Instant completedAt) {
        return new TusUpload(u.id(), u.category(), u.region(), u.originalName(), u.contentType(),
                u.uploadedBy(), u.bucket(), u.objectKey(), u.s3UploadId(), u.length(), u.partSize(),
                offset, busyMs, u.traceId(), completedAt != null ? completedAt : u.completedAt(),
                u.createdAt(), u.updatedAt());
    }
}
