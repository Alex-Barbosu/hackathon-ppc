package ro.ppc.filegrid.tus;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * In-memory {@link TusObjectStore} that enforces the S3 rule the real one does: every part
 * except the last must be at least 5 MB. It keeps the size of each part so tests can check them.
 */
final class FakeObjectStore implements TusObjectStore {

    static final int S3_MIN_PART = 5 * 1024 * 1024;

    final Map<String, byte[]> objects = new HashMap<>();
    final Map<String, byte[]> tails = new HashMap<>();
    final Map<Integer, byte[]> pending = new HashMap<>();
    final List<Integer> partSizes = new ArrayList<>();
    final Set<String> aborted = new HashSet<>();
    int opens;
    boolean failParts;

    @Override
    public String begin(String bucket, String key, String contentType) {
        return "s3-upload-" + key;
    }

    @Override
    public String putPart(String bucket, String key, String s3UploadId, int partNumber, byte[] buf, int len) {
        if (failParts) {
            throw new IllegalStateException("s3 is down");
        }
        pending.put(partNumber, Arrays.copyOf(buf, len));
        return "etag-" + partNumber;
    }

    @Override
    public void complete(String bucket, String key, String s3UploadId, List<TusStore.PartRef> parts) {
        ByteArrayOutputStream all = new ByteArrayOutputStream();
        partSizes.clear();
        for (int i = 0; i < parts.size(); i++) {
            byte[] p = pending.get(parts.get(i).partNumber());
            if (!("etag-" + parts.get(i).partNumber()).equals(parts.get(i).etag())) {
                throw new IllegalStateException("etag mismatch");
            }
            if (i < parts.size() - 1 && p.length < S3_MIN_PART) {
                throw new IllegalStateException("S3 would reject part " + (i + 1) + ": " + p.length + " bytes");
            }
            partSizes.add(p.length);
            all.writeBytes(p);
        }
        objects.put(bucket + "/" + key, all.toByteArray());
    }

    @Override
    public void abort(String bucket, String key, String s3UploadId) {
        aborted.add(key);
    }

    @Override
    public long size(String bucket, String key) {
        return objects.get(bucket + "/" + key).length;
    }

    @Override
    public InputStream open(String bucket, String key) {
        opens++;
        return new ByteArrayInputStream(objects.get(bucket + "/" + key));
    }

    @Override
    public void putTail(String bucket, String uploadKey, byte[] buf, int len) {
        tails.put(uploadKey, Arrays.copyOf(buf, len));
    }

    @Override
    public Optional<byte[]> getTail(String bucket, String uploadKey) {
        return Optional.ofNullable(tails.get(uploadKey));
    }

    @Override
    public void deleteTail(String bucket, String uploadKey) {
        tails.remove(uploadKey);
    }
}
