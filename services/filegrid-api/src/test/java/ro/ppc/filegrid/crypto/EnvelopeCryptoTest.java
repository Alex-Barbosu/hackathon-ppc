package ro.ppc.filegrid.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class EnvelopeCryptoTest {

    private static final int SEALED_SEGMENT = Segments.PLAIN + Segments.TAG;

    private final EnvelopeCrypto crypto = new EnvelopeCrypto("ab".repeat(32));
    private final UUID file = UUID.randomUUID();

    private static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        new Random(7).nextBytes(b);
        return b;
    }

    private byte[] seal(byte[] plain, EnvelopeCrypto.Envelope e, UUID id) throws IOException {
        return crypto.encrypt(new ByteArrayInputStream(plain), e, id).readAllBytes();
    }

    private byte[] open(byte[] sealed, EnvelopeCrypto.Envelope e, UUID id) throws IOException {
        return crypto.decrypt(new ByteArrayInputStream(sealed),
                crypto.unwrap(e.wrappedKey(), id), e.iv(), id).readAllBytes();
    }

    // ------------------------------------------------------------------ round trip

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 100, 65_535, 65_536, 65_537, 131_072, 200_000, 1_000_000})
    void everySizeRoundTripsAndHasThePredictedLength(int size) throws Exception {
        byte[] plain = randomBytes(size);
        var e = crypto.newEnvelope(file);

        byte[] sealed = seal(plain, e, file);

        assertThat(sealed).hasSize((int) EnvelopeCrypto.ciphertextLength(size));
        assertThat(open(sealed, e, file)).isEqualTo(plain);
    }

    @Test
    void singleByteReadsWorkToo() throws Exception {
        byte[] plain = randomBytes(70_000);
        var e = crypto.newEnvelope(file);
        InputStream in = crypto.encrypt(new ByteArrayInputStream(plain), e, file);
        byte[] sealed = new byte[(int) EnvelopeCrypto.ciphertextLength(plain.length)];
        for (int i = 0; i < sealed.length; i++) {
            sealed[i] = (byte) in.read();
        }
        assertThat(in.read()).isEqualTo(-1);

        InputStream out = crypto.decrypt(new ByteArrayInputStream(sealed), crypto.unwrap(e.wrappedKey(), file), e.iv(), file);
        byte[] back = new byte[plain.length];
        for (int i = 0; i < back.length; i++) {
            back[i] = (byte) out.read();
        }
        assertThat(out.read()).isEqualTo(-1);
        assertThat(back).isEqualTo(plain);
    }

    @Test
    void storageSeesNoPlaintext() throws Exception {
        byte[] marker = "PERSONAL-DATA Ion Popescu CNP 0000000000000 ".getBytes(StandardCharsets.UTF_8);
        byte[] plain = new byte[200_000];
        for (int i = 0; i < plain.length; i++) {
            plain[i] = marker[i % marker.length];
        }
        byte[] sealed = seal(plain, crypto.newEnvelope(file), file);

        assertThat(new String(sealed, StandardCharsets.ISO_8859_1)).doesNotContain("PERSONAL-DATA").doesNotContain("Popescu");
    }

    @Test
    void theSamePlaintextSealedTwiceLooksDifferent() throws Exception {
        byte[] plain = randomBytes(5000);

        assertThat(seal(plain, crypto.newEnvelope(file), file)).isNotEqualTo(seal(plain, crypto.newEnvelope(file), file));
    }

    @Test
    void aLargeFileStreamsThroughBothDirectionsWithTheRightHash() throws Exception {
        // 40 MB generated on the fly: nothing here holds the whole file, and the digest proves it round-trips.
        long total = 40L * 1024 * 1024;
        InputStream source = new InputStream() {
            long sent;
            final Random r = new Random(1);

            @Override
            public int read() {
                return sent < total ? (int) (sent++ & 0xff) : -1;
            }

            @Override
            public int read(byte[] b, int off, int len) {
                if (sent >= total) {
                    return -1;
                }
                int n = (int) Math.min(len, total - sent);
                for (int i = 0; i < n; i++) {
                    b[off + i] = (byte) (r.nextInt() >> 3);
                }
                sent += n;
                return n;
            }
        };
        MessageDigest before = MessageDigest.getInstance("SHA-256");
        MessageDigest after = MessageDigest.getInstance("SHA-256");
        var e = crypto.newEnvelope(file);

        InputStream sealed = crypto.encrypt(new java.security.DigestInputStream(source, before), e, file);
        InputStream plain = crypto.decrypt(sealed, crypto.unwrap(e.wrappedKey(), file), e.iv(), file);
        byte[] buf = new byte[8192];
        long n = 0;
        int r;
        while ((r = plain.read(buf)) != -1) {
            after.update(buf, 0, r);
            n += r;
        }

        assertThat(n).isEqualTo(total);
        assertThat(after.digest()).isEqualTo(before.digest());
    }

    // ------------------------------------------------------------------ tampering

    @Test
    void aFlippedByteIsDetectedWhereverItIs() throws Exception {
        byte[] plain = randomBytes(200_000);
        var e = crypto.newEnvelope(file);
        byte[] sealed = seal(plain, e, file);

        for (int pos : new int[] {0, 1000, SEALED_SEGMENT - 1, SEALED_SEGMENT, sealed.length / 2, sealed.length - 1}) {
            byte[] bad = sealed.clone();
            bad[pos] ^= 1;
            assertThatThrownBy(() -> open(bad, e, file)).as("byte %d", pos).isInstanceOf(CorruptCiphertextException.class);
        }
    }

    @Test
    void aFileCutAtASegmentBoundaryIsDetected() throws Exception {
        byte[] plain = randomBytes(200_000);
        var e = crypto.newEnvelope(file);
        byte[] sealed = seal(plain, e, file);

        // Whole segments missing from the end: each remaining segment is valid on its own,
        // but none of them carries the last-segment flag.
        for (int keep = 1; keep <= 3; keep++) {
            byte[] cut = Arrays.copyOf(sealed, keep * SEALED_SEGMENT);
            assertThatThrownBy(() -> open(cut, e, file)).isInstanceOf(CorruptCiphertextException.class);
        }
        assertThatThrownBy(() -> open(new byte[0], e, file)).isInstanceOf(CorruptCiphertextException.class);
    }

    @Test
    void extraBytesAfterTheEndAreDetected() throws Exception {
        var e = crypto.newEnvelope(file);
        byte[] sealed = seal(randomBytes(100_000), e, file);

        byte[] tail = Arrays.copyOf(sealed, sealed.length + 100);
        assertThatThrownBy(() -> open(tail, e, file)).isInstanceOf(CorruptCiphertextException.class);
        byte[] whole = Arrays.copyOf(sealed, sealed.length + SEALED_SEGMENT);
        assertThatThrownBy(() -> open(whole, e, file)).isInstanceOf(CorruptCiphertextException.class);
    }

    @Test
    void swappedSegmentsAreDetected() throws Exception {
        var e = crypto.newEnvelope(file);
        byte[] sealed = seal(randomBytes(3 * Segments.PLAIN), e, file);
        byte[] swapped = sealed.clone();
        System.arraycopy(sealed, SEALED_SEGMENT, swapped, 0, SEALED_SEGMENT);
        System.arraycopy(sealed, 0, swapped, SEALED_SEGMENT, SEALED_SEGMENT);

        assertThatThrownBy(() -> open(swapped, e, file)).isInstanceOf(CorruptCiphertextException.class);
    }

    @Test
    void ciphertextMovedToAnotherFileIdIsRefused() throws Exception {
        var e = crypto.newEnvelope(file);
        byte[] sealed = seal(randomBytes(5000), e, file);
        UUID other = UUID.randomUUID();

        // Even with the right key and iv, the file id is part of what was authenticated.
        InputStream in = crypto.decrypt(new ByteArrayInputStream(sealed), crypto.unwrap(e.wrappedKey(), file), e.iv(), other);
        assertThatThrownBy(in::readAllBytes).isInstanceOf(CorruptCiphertextException.class);
    }

    // ------------------------------------------------------------------ keys

    @Test
    void aWrappedKeyOnlyOpensForItsOwnFile() {
        var e = crypto.newEnvelope(file);

        assertThat(crypto.unwrap(e.wrappedKey(), file)).isEqualTo(e.dataKey());
        assertThatThrownBy(() -> crypto.unwrap(e.wrappedKey(), UUID.randomUUID()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aWrappedKeyDoesNotOpenUnderAnotherMasterKey() {
        var e = crypto.newEnvelope(file);
        var other = new EnvelopeCrypto("cd".repeat(32));

        assertThatThrownBy(() -> other.unwrap(e.wrappedKey(), file)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void anAlteredOrMalformedWrappedKeyIsRefused() {
        var e = crypto.newEnvelope(file);
        byte[] bad = e.wrappedKey().clone();
        bad[30] ^= 1;

        assertThatThrownBy(() -> crypto.unwrap(bad, file)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> crypto.unwrap(new byte[5], file)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> crypto.unwrap(null, file)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void everyFileGetsItsOwnKeyAndIv() {
        var a = crypto.newEnvelope(file);
        var b = crypto.newEnvelope(file);

        assertThat(a.dataKey()).isNotEqualTo(b.dataKey());
        assertThat(a.iv()).isNotEqualTo(b.iv()).hasSize(7);
        assertThat(a.wrappedKey()).hasSize(61);
        assertThat(a.wrappedKey()[0]).as("master key version").isEqualTo((byte) 1);
    }

    @Test
    void theMasterKeyMustBe64HexCharacters() {
        for (String bad : new String[] {null, "", "short", "ab".repeat(31), "ab".repeat(33), "zz".repeat(32)}) {
            assertThatThrownBy(() -> new EnvelopeCrypto(bad)).as("key '%s'", bad)
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("FILEGRID_MASTER_KEY");
        }
        new EnvelopeCrypto("AB".repeat(32)); // upper case hex is fine
    }
}
