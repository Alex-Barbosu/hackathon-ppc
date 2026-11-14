package ro.ppc.filegrid.files;

import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.crypto.CorruptCiphertextException;

/**
 * Passes the original bytes of a file through while it hashes them, and checks the SHA-256 against the recorded one
 * before it hands out the last bytes. This is the single-pass download: the first byte leaves at once, with no
 * separate read to hash the whole file first.
 *
 * <p>It always holds back one chunk. A chunk is handed out only after the next one has been read, so when the stored
 * object ends, the hash is known while the final chunk (up to {@value #CHUNK} bytes) is still unsent. If the hash does
 * not match, the stream throws {@link StreamIntegrityException} instead of returning that chunk, so the client never gets
 * a complete body for a corrupt file. The earlier bytes have been sent by then; that is the price of not reading twice.
 * A client can also compare the {@code X-Content-SHA256} header with its own hash.
 *
 * <p>Memory: two chunks, whatever the file size.
 */
final class VerifyingInputStream extends InputStream {

    static final int CHUNK = 64 * 1024;

    /** What happens when the check is done. Exactly one of the three is called, once. */
    interface Listener {
        /** The whole file matched. */
        void verified();

        /** The hash did not match ({@code actual}), or the ciphertext failed authentication. */
        void failed(String actual);

        /** The stream was closed before the end (the client went away, or the storage failed). */
        void closedEarly();
    }

    private final DigestInputStream in;
    private final String expected;
    private final Listener listener;

    private byte[] cur = new byte[CHUNK];
    private byte[] next = new byte[CHUNK];
    private int curLen;
    private int curPos;
    private int nextLen;
    private boolean started;
    private boolean finished;
    private boolean closed;
    private StreamIntegrityException failure;

    VerifyingInputStream(InputStream in, String expectedSha256, Listener listener) {
        MessageDigest md = Hashing.sha256();
        this.in = new DigestInputStream(in, md);
        this.expected = expectedSha256;
        this.listener = listener;
    }

    @Override
    public int read() throws IOException {
        byte[] one = new byte[1];
        int n = read(one, 0, 1);
        return n < 0 ? -1 : one[0] & 0xff;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (failure != null) {
            // Once the check has failed, nothing more comes out, however often it is asked.
            throw failure;
        }
        if (len == 0) {
            return 0;
        }
        if (!available0()) {
            return -1;
        }
        int n = Math.min(len, curLen - curPos);
        System.arraycopy(cur, curPos, b, off, n);
        curPos += n;
        return n;
    }

    /** Makes sure {@code cur} has an unsent byte. False at the end of the file, after the check passed. */
    private boolean available0() throws IOException {
        if (!started) {
            started = true;
            curLen = fill(cur);
            nextLen = curLen == CHUNK ? fill(next) : 0;
            checkIfLast();
        }
        while (curPos >= curLen) {
            if (nextLen == 0) {
                return false;
            }
            byte[] t = cur;
            cur = next;
            next = t;
            curLen = nextLen;
            curPos = 0;
            nextLen = curLen == CHUNK ? fill(next) : 0;
            checkIfLast();
        }
        return true;
    }

    /** When nothing follows the chunk in hand, the whole object has been read: check the hash before it goes out. */
    private void checkIfLast() throws IOException {
        if (nextLen != 0 || finished) {
            return;
        }
        finished = true;
        String actual = Hashing.hex(in.getMessageDigest().digest());
        if (actual.equalsIgnoreCase(expected)) {
            listener.verified();
        } else {
            listener.failed(actual);
            failure = new StreamIntegrityException("the stored file does not match its SHA-256");
            throw failure;
        }
    }

    private int fill(byte[] buf) throws IOException {
        try {
            return in.readNBytes(buf, 0, CHUNK);
        } catch (CorruptCiphertextException e) {
            if (!finished) {
                finished = true;
                listener.failed(FileService.DECRYPTION_FAILED);
            }
            failure = new StreamIntegrityException("the stored file failed authentication");
            throw failure;
        }
    }

    @Override
    public void close() throws IOException {
        if (closed) {
            return;
        }
        closed = true;
        try {
            in.close();
        } finally {
            if (!finished) {
                finished = true;
                listener.closedEarly();
            }
        }
    }

    /** Thrown instead of the last bytes of a file that failed its check. The response is cut short on purpose. */
    static final class StreamIntegrityException extends IOException {
        StreamIntegrityException(String message) {
            super(message);
        }
    }
}
