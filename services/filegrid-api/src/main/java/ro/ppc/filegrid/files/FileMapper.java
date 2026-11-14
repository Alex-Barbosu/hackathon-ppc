package ro.ppc.filegrid.files;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.FileMeta;

/** Row -> FileMeta, re-deriving the receipt signature so GET /files/{id} returns it too. */
final class FileMapper {

    private static final ObjectMapper JSON = new ObjectMapper();
    // The ComtradeRecording fields of the contract. files.metadata may hold more (channel counts, sample rate);
    // those stay in the database and are not promised to clients.
    private static final List<String> RECORDING_KEYS = List.of(
            "format", "station", "recorder", "revision", "faultTime", "startTime", "recordingMs", "lineHz", "clock");

    private FileMapper() {
    }

    /** The COMTRADE part of {@code files.metadata} as the contract's ComtradeRecording, or null when there is none. */
    static Map<String, Object> recording(String metadataJson) {
        if (metadataJson == null || metadataJson.isBlank()) {
            return null;
        }
        try {
            Map<String, Object> all = JSON.readValue(metadataJson, new TypeReference<Map<String, Object>>() { });
            if (!"comtrade".equals(all.get("format"))) {
                return null;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            for (String k : RECORDING_KEYS) {
                if (all.get(k) != null) {
                    out.put(k, all.get(k));
                }
            }
            return out;
        } catch (Exception e) {
            // Metadata is a description of the file, never a reason to fail reading it.
            return null;
        }
    }

    static FileMeta toMeta(FileRow r, ReceiptSigner signer) {
        String signature = signer.sign(r.id().toString(), r.category(), r.storage(),
                r.sizeBytes(), r.sha256());
        return new FileMeta(
                r.id().toString(),
                r.category(),
                r.storage(),
                r.sizeBytes(),
                r.sha256(),
                r.createdAt(),
                r.encrypted(),
                r.traceId(),
                signature,
                r.originalName(),
                r.contentType(),
                r.region(),
                r.county(),
                r.description(),
                recording(r.metadata()),
                r.uploadedBy(),
                r.lastVerifiedAt(),
                r.status());
    }

    // Kept so callers see the enum round-trips; validation happens here.
    static void assertKnown(FileRow r) {
        Category.fromSlug(r.category());
        Storage.fromSlug(r.storage());
    }
}
