package ro.ppc.filegrid.files.dto;

import java.time.OffsetDateTime;

/** DownloadLink schema (contracts/openapi.yaml): a 60 s URL plus the hash the UI shows. */
public record DownloadLink(String url, OffsetDateTime expiresAt, String sha256) {
}
