package ro.ppc.filegrid.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Small SHA-256 helpers. */
public final class Hashing {

    private Hashing() {
    }

    public static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public static String hex(byte[] digest) {
        return HexFormat.of().formatHex(digest);
    }

    public static byte[] hmacSha256(byte[] key, byte[] message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 failed", e);
        }
    }

    /**
     * Compares two secrets without leaking where they differ or how long the match prefix is:
     * both sides are hashed first, so the comparison always runs over 32 bytes.
     */
    public static boolean secretsEqual(String a, String b) {
        byte[] ha = sha256().digest(a.getBytes(StandardCharsets.UTF_8));
        byte[] hb = sha256().digest(b.getBytes(StandardCharsets.UTF_8));
        return MessageDigest.isEqual(ha, hb);
    }
}
