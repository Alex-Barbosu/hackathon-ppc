package ro.ppc.filegrid.storage;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/** Counts bytes read without buffering, so a backend can report a stored size while streaming. */
public final class CountingInputStream extends FilterInputStream {

    private long count;

    public CountingInputStream(InputStream in) {
        super(in);
    }

    @Override
    public int read() throws IOException {
        int b = super.read();
        if (b != -1) {
            count++;
        }
        return b;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0) {
            count += n;
        }
        return n;
    }

    public long count() {
        return count;
    }
}
