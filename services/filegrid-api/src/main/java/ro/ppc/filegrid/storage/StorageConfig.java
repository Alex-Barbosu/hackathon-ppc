package ro.ppc.filegrid.storage;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
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
            @Value("${S3_REGION:us-east-1}") String region) {
        return S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(accessKey, secretKey)))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(true)
                        .build())
                .build();
    }
}
