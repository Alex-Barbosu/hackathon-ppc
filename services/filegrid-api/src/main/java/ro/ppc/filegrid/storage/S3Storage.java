package ro.ppc.filegrid.storage;

import java.io.InputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.sync.ResponseTransformer;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

/**
 * SeaweedFS over the S3 API. Path-style addressing and the SeaweedFS endpoint are set on the
 * client bean (see StorageConfig). One bucket per category: {@code filegrid-<category>}
 * (zone B pre-creates them).
 *
 * <p>For a single PUT the SDK needs the content length up front, so the upload path passes
 * {@code sizeHint} (always known for multipart form uploads). Streamed uploads of unknown
 * length (tus video) use S3 multipart in the P1 work, not this method.
 */
@Component
public class S3Storage implements StorageAdapter {

    private static final Logger log = LoggerFactory.getLogger(S3Storage.class);

    private final S3Client s3;

    public S3Storage(S3Client s3) {
        this.s3 = s3;
    }

    @Override
    public Storage kind() {
        return Storage.S3;
    }

    public static String bucketFor(Category category) {
        return "filegrid-" + category.slug();
    }

    @Override
    public StoredRef write(InputStream body, String key, WriteMeta meta) {
        if (meta.sizeHint() < 0) {
            throw new IllegalArgumentException(
                    "S3 single PUT needs a known size; use multipart for unknown-length streams");
        }
        String bucket = bucketFor(meta.category());
        PutObjectRequest req = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(meta.contentType())
                .build();
        // fromInputStream streams; the SDK does not buffer the whole body.
        s3.putObject(req, RequestBody.fromInputStream(body, meta.sizeHint()));
        return new StoredRef(Storage.S3, bucket + "/" + key, meta.sizeHint());
    }

    @Override
    public InputStream read(String key) {
        BucketKey bk = BucketKey.parse(key);
        GetObjectRequest req = GetObjectRequest.builder().bucket(bk.bucket()).key(bk.key()).build();
        try {
            return s3.getObject(req, ResponseTransformer.toInputStream());
        } catch (NoSuchKeyException e) {
            return null;
        }
    }

    @Override
    public void delete(String key) {
        BucketKey bk = BucketKey.parse(key);
        s3.deleteObject(DeleteObjectRequest.builder().bucket(bk.bucket()).key(bk.key()).build());
    }

    @Override
    public boolean health() {
        // Any bucket probe proves the endpoint answers; outage bucket always exists.
        try {
            s3.headBucket(HeadBucketRequest.builder().bucket(bucketFor(Category.OUTAGE)).build());
            return true;
        } catch (Exception e) {
            log.debug("s3 health probe failed: {}", e.toString());
            return false;
        }
    }

    /** Object keys are stored as {@code bucket/key}; split once on the first slash. */
    private record BucketKey(String bucket, String key) {
        static BucketKey parse(String objectKey) {
            int slash = objectKey.indexOf('/');
            if (slash < 0) {
                throw new IllegalArgumentException("s3 object key must be bucket/key: " + objectKey);
            }
            return new BucketKey(objectKey.substring(0, slash), objectKey.substring(slash + 1));
        }
    }
}
