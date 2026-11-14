package ro.ppc.filegrid.files;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * HMAC-SHA256 over the receipt's load-bearing fields, so a UI can prove a receipt was issued
 * by FileGrid and not altered (contracts: FileReceipt.signature). Key is JWT_SECRET from env.
 */
@Component
public class ReceiptSigner {

    private final byte[] key;

    public ReceiptSigner(@Value("${JWT_SECRET:dev-secret}") String secret) {
        this.key = secret.getBytes(StandardCharsets.UTF_8);
    }

    public String sign(String id, String category, String storage, long sizeBytes, String sha256) {
        String payload = String.join("|", id, category, storage, Long.toString(sizeBytes), sha256);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("cannot sign receipt", e);
        }
    }
}
