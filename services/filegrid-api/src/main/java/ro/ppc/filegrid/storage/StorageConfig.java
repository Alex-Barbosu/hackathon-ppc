package ro.ppc.filegrid.storage;

import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.awscore.retry.AwsRetryStrategy;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

/**
 * Builds the S3 client against SeaweedFS. Path-style is mandatory for SeaweedFS (no
 * virtual-host buckets), and the endpoint + credentials come from env (compose.yml), never
 * from code.
 */
@Configuration
public class StorageConfig {

    @Bean
    S3Client s3Client(
            @Value("${S3_ENDPOINT:http://seaweedfs:8333}") String endpoint,
            @Value("${S3_ACCESS_KEY:}") String accessKey,
            @Value("${S3_SECRET_KEY:}") String secretKey,
            @Value("${S3_REGION:us-east-1}") String region,
            @Value("${filegrid.s3.connect-timeout-ms:2000}") long connectMs,
            @Value("${filegrid.s3.idle-timeout-ms:8000}") long idleMs) {
        return S3Client.builder()
                // An S3 that accepts a connection and then says nothing (a container shutting down, a dead
                // link) used to hold a write for the SDK's default 30 s before the fallback could take over.
                // The idle limit is time with no bytes moving, not the length of a transfer, so a 1 GB
                // upload over a slow link is not cut: only a silent peer is.
                .httpClientBuilder(ApacheHttpClient.builder()
                        .connectionTimeout(Duration.ofMillis(connectMs))
                        .socketTimeout(Duration.ofMillis(idleMs)))
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(accessKey, secretKey)))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(true)
                        .build())
                // No hidden retries: the circuit breaker and the fallback decide what to do about a
                // failure, and an upload body cannot be replayed from inside the SDK anyway.
                .overrideConfiguration(c -> c.retryStrategy(AwsRetryStrategy.doNotRetry()))
                .build();
    }
}
