package ro.ppc.filegrid.crypto;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.security.GeneralSecurityException;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;

/**
 * Pulls ciphertext from {@code cipher} and yields plaintext one segment at a time. Each
 * segment is authenticated before any of its bytes are released; a bad segment, a missing last
 * segment or extra bytes after it throw {@link CorruptCiphertextException}.
 */
final class DecryptingInputStream extends InputStream {

    private final PushbackInputStream in;
    private final SecretKey key;
    private final byte[] iv;
    private final byte[] aad;
    private final byte[] sealed = new byte[Segments.PLAIN + Segments.TAG];

    private byte[] out = new byte[0];
    private int outPos;
    private long counter;
    private boolean finished;

    DecryptingInputStream(InputStream cipher, SecretKey key, byte[] iv, byte[] aad) {
        this.in = new PushbackInputStream(cipher, 1);
        this.key = key;
        this.iv = iv;
        this.aad = aad;
    }

    @Override
    public int read() throws IOException {
        byte[] one = new byte[1];
        return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (len == 0) {
            return 0;
        }
        while (outPos >= out.length) {
            if (finished) {
                return -1;
            }
            nextSegment();
        }
        int n = Math.min(len, out.length - outPos);
        System.arraycopy(out, outPos, b, off, n);
        outPos += n;
        return n;
    }

    private void nextSegment() throws IOException {
        int n = Segments.readFully(in, sealed);
        if (n < Segments.TAG) {
            // Even an empty file has one segment (its tag), so this is a cut file.
            throw new CorruptCiphertextException("stored data is truncated");
        }
        boolean last = n < sealed.length || Segments.atEnd(in);
        try {
            Cipher c = Segments.cipher(Cipher.DECRYPT_MODE, key, Segments.nonce(iv, counter++, last), aad);
            out = c.doFinal(sealed, 0, n);
        } catch (AEADBadTagException e) {
            throw new CorruptCiphertextException("stored data failed authentication");
        } catch (GeneralSecurityException e) {
            throw new IOException("decryption failed", e);
        }
        outPos = 0;
        finished = last;
    }

    @Override
    public void close() throws IOException {
        in.close();
    }
}
