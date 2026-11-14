package ro.ppc.filegrid.files;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * Passes the bytes through and keeps a copy of the first {@code limit} of them, no more. Memory is the limit,
 * whatever the size of the file, so a large upload still streams with flat memory.
 */
final class HeadCapturingInputStream extends FilterInputStream {

    private final byte[] head;
    private int captured;

    HeadCapturingInputStream(InputStream in, int limit) {
        super(in);
        this.head = new byte[limit];
    }

    @Override
    public int read() throws IOException {
        int b = super.read();
        if (b >= 0 && captured < head.length) {
            head[captured++] = (byte) b;
        }
        return b;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0 && captured < head.length) {
            int take = Math.min(n, head.length - captured);
            System.arraycopy(b, off, head, captured, take);
            captured += take;
        }
        return n;
    }

    /** The bytes kept so far: the start of the file, or all of it if it is shorter than the limit. */
    byte[] head() {
        return Arrays.copyOf(head, captured);
    }
}
