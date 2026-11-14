package ro.ppc.filegrid.observability;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.exporter.otlp.http.logs.OtlpHttpLogRecordExporter;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.export.BatchLogRecordProcessor;
import io.opentelemetry.sdk.resources.Resource;
import java.time.Duration;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The OTLP side of {@link OtlpLogAppender}: an exporter to the collector's HTTP endpoint (the same
 * OTEL_EXPORTER_OTLP_ENDPOINT the traces use, path {@code /v1/logs}), batched, and the appender switched on.
 * The batch is sent in the background, so a slow or absent collector never slows a request; if the queue fills,
 * the newest lines are dropped.
 */
@Configuration
public class OtlpLogsConfig {

    @Bean(destroyMethod = "close")
    SdkLoggerProvider sdkLoggerProvider(
            @Value("${filegrid.otel.logs-endpoint}") String endpoint,
            @Value("${spring.application.name:filegrid-api}") String service,
            @Value("${filegrid.version:0.1.0}") String version) {
        Resource resource = Resource.getDefault().merge(Resource.create(io.opentelemetry.api.common.Attributes.builder()
                .put(AttributeKey.stringKey("service.name"), service)
                .put(AttributeKey.stringKey("service.version"), version)
                .build()));
        var exporter = OtlpHttpLogRecordExporter.builder().setEndpoint(endpoint).setTimeout(Duration.ofSeconds(5)).build();
        return SdkLoggerProvider.builder()
                .setResource(resource)
                .addLogRecordProcessor(BatchLogRecordProcessor.builder(exporter)
                        .setScheduleDelay(Duration.ofSeconds(1)).setMaxQueueSize(4096).build())
                .build();
    }

    @Bean
    InitializingBean installOtlpLogAppender(SdkLoggerProvider provider) {
        return () -> OtlpLogAppender.install(provider.get("filegrid-api"));
    }
}
