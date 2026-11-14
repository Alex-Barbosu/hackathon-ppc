package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.crypto.CorruptCiphertextException;

class VerifyingInputStreamTest {

    private static final int CHUNK = VerifyingInputStream.CHUNK;

    /** Records what the stream reports, so a test can check it is told exactly once. */
    private static final class Events implements VerifyingInputStream.Listener {
        final List<String> seen = new ArrayList<>();

        @Override
        public void verified() {
            seen.add("verified");
        }

        @Override
        public void failed(String actual) {
            seen.add("failed:" + actual);
        }

        @Override
        public void closedEarly() {
            seen.add("closedEarly");
        }
    }

    private static byte[] bytes(int n) {
        byte[] b = new byte[n];
        new Random(7).nextBytes(b);
        return b;
    }

    private static String sha(byte[] b) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Reads until the end or the first failure; returns what was handed out before it. */
    private static byte[] drain(InputStream in) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[10_000];
        try {
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        } catch (IOException expected) {
            // the failure case: the caller looks at what came out before it
        }
        return out.toByteArray();
    }

    @Test
    void aMatchingFileComesOutWhole() throws Exception {
        for (int size : new int[] {1, 100, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 17}) {
            byte[] data = bytes(size);
            Events events = new Events();
            try (VerifyingInputStream in = new VerifyingInputStream(new ByteArrayInputStream(data), sha(data), events)) {
                assertThat(in.readAllBytes()).as("size %d", size).isEqualTo(data);
            }
            assertThat(events.seen).as("size %d", size).containsExactly("verified");
        }
    }

    @Test
    void anEmptyFileIsChecked() throws Exception {
        Events events = new Events();
        try (VerifyingInputStream in = new VerifyingInputStream(new ByteArrayInputStream(new byte[0]), sha(new byte[0]), events)) {
            assertThat(in.read()).isEqualTo(-1);
        }
        assertThat(events.seen).containsExactly("verified");
    }

    @Test
    void theFirstBytesLeaveBeforeTheWholeFileIsRead() throws Exception {
        // A source that counts how much was pulled from it when the first byte is asked for.
        byte[] data = bytes(10 * CHUNK);
        long[] pulled = {0};
        InputStream counting = new ByteArrayInputStream(data) {
            @Override
            public synchronized int read(byte[] b, int off, int len) {
                int n = super.read(b, off, len);
                if (n > 0) {
                    pulled[0] += n;
                }
                return n;
            }
        };
        try (VerifyingInputStream in = new VerifyingInputStream(counting, sha(data), new Events())) {
            assertThat(in.read()).isGreaterThanOrEqualTo(0);
            assertThat(pulled[0]).as("read ahead is at most two chunks").isLessThanOrEqualTo(2L * CHUNK);
        }
    }

    @Test
    void aCorruptFileNeverReleasesItsLastChunk() throws Exception {
        for (int size : new int[] {5, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 17}) {
            byte[] stored = bytes(size);
            byte[] other = stored.clone();
            other[size - 1] ^= 1;
            Events events = new Events();
            VerifyingInputStream in = new VerifyingInputStream(new ByteArrayInputStream(other), sha(stored), events);

            byte[] got = drain(in);

            // The last chunk (a whole CHUNK, or what is left after the full ones) was not handed out.
            int lastChunk = size % CHUNK == 0 ? CHUNK : size % CHUNK;
            assertThat(got.length).as("size %d", size).isLessThanOrEqualTo(size - lastChunk);
            assertThat(events.seen).as("size %d", size).hasSize(1);
            assertThat(events.seen.get(0)).startsWith("failed:").isEqualTo("failed:" + sha(other));
            in.close();
            assertThat(events.seen).as("closing after a failure adds nothing").hasSize(1);
        }
    }

    @Test
    void afterAFailureNothingMoreComesOut() {
        byte[] stored = bytes(2 * CHUNK + 5);
        byte[] other = stored.clone();
        other[3] ^= 1;
        VerifyingInputStream in = new VerifyingInputStream(new ByteArrayInputStream(other), sha(stored), new Events());
        drain(in);

        assertThatThrownBy(() -> in.read(new byte[100])).isInstanceOf(VerifyingInputStream.StreamIntegrityException.class);
        assertThatThrownBy(in::read).isInstanceOf(VerifyingInputStream.StreamIntegrityException.class);
    }

    @Test
    void aShortFileFailsToo() {
        byte[] stored = bytes(2 * CHUNK + 5);
        byte[] cut = java.util.Arrays.copyOf(stored, 2 * CHUNK);
        Events events = new Events();
        drain(new VerifyingInputStream(new ByteArrayInputStream(cut), sha(stored), events));
        assertThat(events.seen).hasSize(1);
        assertThat(events.seen.get(0)).startsWith("failed:");
    }

    @Test
    void closingEarlyIsReportedOnce() throws Exception {
        byte[] data = bytes(5 * CHUNK);
        Events events = new Events();
        VerifyingInputStream in = new VerifyingInputStream(new ByteArrayInputStream(data), sha(data), events);
        in.read(new byte[10]);
        in.close();
        in.close();
        assertThat(events.seen).containsExactly("closedEarly");
    }

    @Test
    void closingAfterTheEndAddsNothing() throws Exception {
        byte[] data = bytes(CHUNK + 3);
        Events events = new Events();
        VerifyingInputStream in = new VerifyingInputStream(new ByteArrayInputStream(data), sha(data), events);
        in.readAllBytes();
        in.close();
        assertThat(events.seen).containsExactly("verified");
    }

    @Test
    void aFailedDecryptionIsReportedAsOne() {
        // A decrypting stream that fails in the middle, as AES-GCM does for an altered segment.
        InputStream bad = new InputStream() {
            int n;

            @Override
            public int read() throws IOException {
                if (n++ > 10) {
                    throw new CorruptCiphertextException("altered");
                }
                return 1;
            }
        };
        Events events = new Events();
        VerifyingInputStream in = new VerifyingInputStream(bad, "00".repeat(32), events);

        assertThatThrownBy(() -> in.readAllBytes()).isInstanceOf(VerifyingInputStream.StreamIntegrityException.class);
        assertThat(events.seen).containsExactly("failed:" + FileService.DECRYPTION_FAILED);
    }
}
