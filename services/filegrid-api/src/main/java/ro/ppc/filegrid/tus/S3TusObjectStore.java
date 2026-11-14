package ro.ppc.filegrid.tus;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.sync.ResponseTransformer;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.AbortMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.CompleteMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.CompletedMultipartUpload;
import software.amazon.awssdk.services.s3.model.CompletedPart;
import software.amazon.awssdk.services.s3.model.CreateMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.UploadPartRequest;

/** {@link TusObjectStore} on the S3 API (SeaweedFS). The parts go straight from the request to S3. */
@Component
public class S3TusObjectStore implements TusObjectStore {

    private final S3Client s3;

    public S3TusObjectStore(S3Client s3) {
        this.s3 = s3;
    }

    @Override
    public String begin(String bucket, String key, String contentType) {
        return s3.createMultipartUpload(CreateMultipartUploadRequest.builder()
                .bucket(bucket).key(key).contentType(contentType).build()).uploadId();
    }

    @Override
    public String putPart(String bucket, String key, String s3UploadId, int partNumber, byte[] buf, int len) {
        // Wrap the buffer instead of copying it: RequestBody.fromBytes would clone 16 MB per part.
        return s3.uploadPart(UploadPartRequest.builder().bucket(bucket).key(key)
                        .uploadId(s3UploadId).partNumber(partNumber).contentLength((long) len).build(),
                RequestBody.fromInputStream(new ByteArrayInputStream(buf, 0, len), len)).eTag();
    }

    @Override
    public void complete(String bucket, String key, String s3UploadId, List<TusStore.PartRef> parts) {
        List<CompletedPart> completed = parts.stream()
                .map(p -> CompletedPart.builder().partNumber(p.partNumber()).eTag(p.etag()).build()).toList();
        s3.completeMultipartUpload(CompleteMultipartUploadRequest.builder().bucket(bucket).key(key)
                .uploadId(s3UploadId)
                .multipartUpload(CompletedMultipartUpload.builder().parts(completed).build()).build());
    }

    @Override
    public void abort(String bucket, String key, String s3UploadId) {
        s3.abortMultipartUpload(AbortMultipartUploadRequest.builder()
                .bucket(bucket).key(key).uploadId(s3UploadId).build());
    }

    @Override
    public long size(String bucket, String key) {
        return s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build()).contentLength();
    }

    @Override
    public InputStream open(String bucket, String key) {
        return s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build(),
                ResponseTransformer.toInputStream());
    }

    @Override
    public void putTail(String bucket, String uploadKey, byte[] buf, int len) {
        s3.putObject(PutObjectRequest.builder().bucket(bucket).key(tailKey(uploadKey)).build(),
                RequestBody.fromInputStream(new ByteArrayInputStream(buf, 0, len), len));
    }

    @Override
    public Optional<byte[]> getTail(String bucket, String uploadKey) {
        try {
            return Optional.of(s3.getObject(GetObjectRequest.builder().bucket(bucket).key(tailKey(uploadKey)).build(),
                    ResponseTransformer.toBytes()).asByteArray());
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        }
    }

    @Override
    public void deleteTail(String bucket, String uploadKey) {
        s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(tailKey(uploadKey)).build());
    }

    /** Leftovers sit under a dot-prefix so they never look like a stored file. */
    private static String tailKey(String uploadKey) {
        return ".tus/" + uploadKey + ".tail";
    }
}
