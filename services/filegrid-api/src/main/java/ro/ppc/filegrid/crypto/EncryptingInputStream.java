package ro.ppc.filegrid.crypto;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.security.GeneralSecurityException;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;

/** Pulls plaintext from {@code plain} and yields ciphertext, one 64 KiB segment at a time. */
final class EncryptingInputStream extends InputStream {

    private final PushbackInputStream in;
    private final SecretKey key;
    private final byte[] iv;
    private final byte[] aad;
    private final byte[] plain = new byte[Segments.PLAIN];

    private byte[] out = new byte[0];
    private int outPos;
    private long counter;
    private boolean finished;

    EncryptingInputStream(InputStream plain, SecretKey key, byte[] iv, byte[] aad) {
        this.in = new PushbackInputStream(plain, 1);
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
        int n = Segments.readFully(in, plain);
        // A full segment is only the last one if nothing follows it, so a file that is an exact
        // multiple of the segment size does not end with a pointless empty segment. An empty
        // file is one empty last segment (just a tag).
        boolean last = n < Segments.PLAIN || Segments.atEnd(in);
        try {
            Cipher c = Segments.cipher(Cipher.ENCRYPT_MODE, key, Segments.nonce(iv, counter++, last), aad);
            out = c.doFinal(plain, 0, n);
        } catch (GeneralSecurityException e) {
            throw new IOException("encryption failed", e);
        }
        outPos = 0;
        finished = last;
    }

    @Override
    public void close() throws IOException {
        in.close();
    }
}
