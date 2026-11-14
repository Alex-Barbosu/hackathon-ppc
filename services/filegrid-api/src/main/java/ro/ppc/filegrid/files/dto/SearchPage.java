package ro.ppc.filegrid.files.dto;

import java.util.List;

/** SearchPage schema (contracts/openapi.yaml). */
public record SearchPage(List<FileMeta> items, int page, int size, long total) {
}
