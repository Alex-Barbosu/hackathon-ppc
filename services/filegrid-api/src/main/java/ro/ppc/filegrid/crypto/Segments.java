package ro.ppc.filegrid.crypto;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.security.GeneralSecurityException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The segment format shared by the encrypting and decrypting streams.
 *
 * <p>A file is cut into 64 KiB segments, each sealed on its own with AES-256-GCM, so both
 * directions stream with a fixed amount of memory (the JDK's GCM would otherwise hold a whole
 * file before releasing a single decrypted byte). To stop an attacker who can write to storage
 * from cutting, reordering or extending a file, every segment's nonce carries its position and
 * a last-segment flag:
 * <pre>nonce = 7 random bytes (the file's iv) | segment number (4 bytes) | 1 if last else 0</pre>
 * and the file id is authenticated data, so ciphertext cannot be moved to another file.
 */
final class Segments {

    static final int PLAIN = 64 * 1024;
    static final int TAG = 16;

    private Segments() {
    }

    static byte[] nonce(byte[] iv, long number, boolean last) {
        if (number > 0xFFFFFFFFL) {
            throw new IllegalStateException("file too large for the segment counter");
        }
        byte[] n = new byte[12];
        System.arraycopy(iv, 0, n, 0, 7);
        n[7] = (byte) (number >>> 24);
        n[8] = (byte) (number >>> 16);
        n[9] = (byte) (number >>> 8);
        n[10] = (byte) number;
        n[11] = (byte) (last ? 1 : 0);
        return n;
    }

    static Cipher cipher(int mode, SecretKey key, byte[] nonce, byte[] aad) throws GeneralSecurityException {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(mode, key, new GCMParameterSpec(TAG * 8, nonce));
        c.updateAAD(aad);
        return c;
    }

    /** Reads until {@code buf} is full or the stream ends; returns how many bytes it got. */
    static int readFully(InputStream in, byte[] buf) throws IOException {
        int n = 0;
        while (n < buf.length) {
            int r = in.read(buf, n, buf.length - n);
            if (r < 0) {
                break;
            }
            n += r;
        }
        return n;
    }

    /** True if nothing more can be read (without consuming anything). */
    static boolean atEnd(PushbackInputStream in) throws IOException {
        int c = in.read();
        if (c < 0) {
            return true;
        }
        in.unread(c);
        return false;
    }
}
