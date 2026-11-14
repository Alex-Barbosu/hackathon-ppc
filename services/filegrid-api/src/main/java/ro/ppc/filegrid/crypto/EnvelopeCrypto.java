package ro.ppc.filegrid.crypto;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.common.Hashing;

/**
 * Envelope encryption for categories whose policy says {@code encrypt: true}.
 *
 * <ul>
 *   <li>Every file gets its own random 256-bit data key and a random 7-byte {@code iv}.
 *   <li>The data key is stored wrapped (AES-256-GCM) under a key derived from
 *       FILEGRID_MASTER_KEY, with the file id as authenticated data, so a wrapped key copied
 *       onto another row is useless. Layout: {@code 0x01 | nonce(12) | sealed key(48)}; the
 *       leading byte is the master-key version, so a rotation can tell old rows from new.
 *   <li>The bytes are sealed in 64 KiB AES-GCM segments (see {@link Segments}), so storage
 *       only ever holds ciphertext and nothing is buffered beyond one segment.
 * </ul>
 * The master key lives only in the environment. A direct breach of the database, the FTP
 * volume or the bucket yields ciphertext and wrapped keys, which are useless without it.
 */
@Service
public class EnvelopeCrypto {

    private static final byte KEY_VERSION = 1;
    private static final int WRAPPED_LENGTH = 1 + 12 + 32 + Segments.TAG;
    private static final Pattern HEX_KEY = Pattern.compile("[0-9a-fA-F]{64}");

    private final SecretKey kek;
    private final SecureRandom random = new SecureRandom();

    @Autowired
    public EnvelopeCrypto(@Value("${FILEGRID_MASTER_KEY:}") String masterKeyHex) {
        // Fail at startup: a missing or short key must never silently mean "store in clear".
        if (masterKeyHex == null || !HEX_KEY.matcher(masterKeyHex).matches()) {
            throw new IllegalStateException("FILEGRID_MASTER_KEY must be 64 hex characters (32 bytes)");
        }
        byte[] master = HexFormat.of().parseHex(masterKeyHex);
        // A purpose-bound key, so the raw master key is never used for anything else.
        this.kek = new SecretKeySpec(Hashing.hmacSha256(master, "filegrid-kek-v1".getBytes(StandardCharsets.UTF_8)), "AES");
    }

    /** Fresh key material for one new file. */
    public record Envelope(SecretKey dataKey, byte[] wrappedKey, byte[] iv) {
    }

    public Envelope newEnvelope(UUID fileId) {
        byte[] dk = new byte[32];
        byte[] iv = new byte[7];
        random.nextBytes(dk);
        random.nextBytes(iv);
        SecretKey dataKey = new SecretKeySpec(dk, "AES");
        return new Envelope(dataKey, wrap(dk, fileId), iv);
    }

    public SecretKey unwrap(byte[] wrapped, UUID fileId) {
        if (wrapped == null || wrapped.length != WRAPPED_LENGTH || wrapped[0] != KEY_VERSION) {
            throw new IllegalStateException("unknown wrapped key format");
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, kek, new javax.crypto.spec.GCMParameterSpec(Segments.TAG * 8,
                    Arrays.copyOfRange(wrapped, 1, 13)));
            c.updateAAD(wrapAad(fileId));
            return new SecretKeySpec(c.doFinal(wrapped, 13, wrapped.length - 13), "AES");
        } catch (GeneralSecurityException e) {
            // Wrong master key, or the row was altered. Either way this file cannot be opened.
            throw new IllegalStateException("cannot unwrap the data key", e);
        }
    }

    /** Wraps {@code plain} so reading the file yields ciphertext. */
    public InputStream encrypt(InputStream plain, Envelope envelope, UUID fileId) {
        return new EncryptingInputStream(plain, envelope.dataKey(), envelope.iv(), dataAad(fileId));
    }

    /** Wraps stored ciphertext so reading yields authenticated plaintext. */
    public InputStream decrypt(InputStream sealed, SecretKey dataKey, byte[] iv, UUID fileId) {
        return new DecryptingInputStream(sealed, dataKey, iv, dataAad(fileId));
    }

    /** Stored size of a file of {@code plainLength} bytes: the data plus one tag per segment. */
    public static long ciphertextLength(long plainLength) {
        long segments = Math.max(1, (plainLength + Segments.PLAIN - 1) / Segments.PLAIN);
        return plainLength + segments * Segments.TAG;
    }

    private byte[] wrap(byte[] dataKey, UUID fileId) {
        try {
            byte[] nonce = new byte[12];
            random.nextBytes(nonce);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, kek, new javax.crypto.spec.GCMParameterSpec(Segments.TAG * 8, nonce));
            c.updateAAD(wrapAad(fileId));
            byte[] sealed = c.doFinal(dataKey);
            byte[] out = new byte[WRAPPED_LENGTH];
            out[0] = KEY_VERSION;
            System.arraycopy(nonce, 0, out, 1, 12);
            System.arraycopy(sealed, 0, out, 13, sealed.length);
            return out;
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("cannot wrap the data key", e);
        }
    }

    private static byte[] wrapAad(UUID fileId) {
        return ("filegrid-wrap-v1|" + fileId).getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] dataAad(UUID fileId) {
        return ("filegrid-data-v1|" + fileId).getBytes(StandardCharsets.UTF_8);
    }
}
