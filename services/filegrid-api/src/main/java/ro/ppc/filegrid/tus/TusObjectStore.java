package ro.ppc.filegrid.tus;

import java.io.InputStream;
import java.util.List;
import java.util.Optional;

/**
 * The object-storage calls a resumable upload needs, kept apart from the AWS SDK so the
 * upload logic can be tested with an in-memory fake.
 */
public interface TusObjectStore {

    /** Starts a multipart upload and returns S3's upload id. */
    String begin(String bucket, String key, String contentType);

    /** Uploads {@code len} bytes of {@code buf} as one part and returns its ETag. */
    String putPart(String bucket, String key, String s3UploadId, int partNumber, byte[] buf, int len);

    void complete(String bucket, String key, String s3UploadId, List<TusStore.PartRef> parts);

    void abort(String bucket, String key, String s3UploadId);

    /** Size of the finished object in bytes. */
    long size(String bucket, String key);

    /** Opens the finished object for a streaming read. */
    InputStream open(String bucket, String key);

    /** Stores the leftover bytes that did not fill a part, next to the object. */
    void putTail(String bucket, String uploadKey, byte[] buf, int len);

    Optional<byte[]> getTail(String bucket, String uploadKey);

    void deleteTail(String bucket, String uploadKey);
}
