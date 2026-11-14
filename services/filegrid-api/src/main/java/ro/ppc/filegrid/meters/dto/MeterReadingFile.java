package ro.ppc.filegrid.meters.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.List;

/** MeterReadingFile schema (contracts/openapi.yaml): one file pushed by a smart meter. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record MeterReadingFile(
        @NotBlank String meterId,
        String region,
        String county,
        Double lat,
        Double lon,
        @NotNull OffsetDateTime periodStart,
        @NotNull Integer seq,
        String firmware,
        List<Interval> intervals) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Interval(OffsetDateTime ts, Double kwh, Double voltage, List<String> flags) {
    }
}
