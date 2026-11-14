package ro.ppc.filegrid.files.dto;

import java.time.OffsetDateTime;

/** VerifyResult schema (contracts/openapi.yaml). */
public record VerifyResult(boolean ok, String expected, String actual, OffsetDateTime checkedAt) {
}
