package ro.ppc.filegrid.resilience;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Wraps the request body and remembers whether reading it failed. When a storage call then
 * throws, {@link #failed()} tells a broken client connection apart from a broken storage.
 */
public final class TrackingInputStream extends FilterInputStream {

    private IOException failure;

    public TrackingInputStream(InputStream in) {
        super(in);
    }

    @Override
    public int read() throws IOException {
        try {
            return super.read();
        } catch (IOException e) {
            failure = e;
            throw e;
        }
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        try {
            return super.read(b, off, len);
        } catch (IOException e) {
            failure = e;
            throw e;
        }
    }

    public boolean failed() {
        return failure != null;
    }

    public IOException failure() {
        return failure;
    }
}
