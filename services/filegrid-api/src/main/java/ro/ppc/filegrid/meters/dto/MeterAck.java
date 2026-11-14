package ro.ppc.filegrid.meters.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;

/** MeterAck schema (contracts/openapi.yaml): result is accepted or duplicate. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MeterAck(String result, String idempotencyKey, OffsetDateTime storedAt) {
}
