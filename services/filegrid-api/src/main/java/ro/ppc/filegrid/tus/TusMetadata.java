package ro.ppc.filegrid.tus;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import ro.ppc.filegrid.common.ApiException;

/** Parses the tus {@code Upload-Metadata} header: {@code key base64value,key2 base64value2}. */
final class TusMetadata {

    private TusMetadata() {
    }

    static Map<String, String> parse(String header) {
        Map<String, String> out = new HashMap<>();
        if (header == null || header.isBlank()) {
            return out;
        }
        for (String pair : header.split(",")) {
            String[] kv = pair.trim().split(" ", 2);
            String key = kv[0].trim();
            if (key.isEmpty() || out.containsKey(key)) {
                throw ApiException.badRequest("invalid Upload-Metadata");
            }
            String value = "";
            if (kv.length == 2 && !kv[1].isBlank()) {
                try {
                    value = new String(Base64.getDecoder().decode(kv[1].trim()), StandardCharsets.UTF_8);
                } catch (IllegalArgumentException e) {
                    // The value itself is not echoed: it may be a person's file name.
                    throw ApiException.badRequest("Upload-Metadata value for '" + key + "' is not base64");
                }
            }
            out.put(key, value);
        }
        return out;
    }
}
