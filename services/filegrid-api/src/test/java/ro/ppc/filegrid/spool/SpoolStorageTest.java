package ro.ppc.filegrid.spool;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

class SpoolStorageTest {

    @TempDir
    Path root;

    private SpoolStorage spool;

    @BeforeEach
    void setUp() {
        spool = new SpoolStorage(root.toString());
    }

    private static WriteMeta meta(Category c) {
        return WriteMeta.of(c, "application/octet-stream", -1);
    }

    private long filesUnderRoot() throws IOException {
        try (Stream<Path> s = Files.walk(root)) {
            return s.filter(Files::isRegularFile).count();
        }
    }

    @Test
    void aWrittenFileReadsBackAndIsKeyedByCategoryAndId() throws Exception {
        String id = UUID.randomUUID().toString();
        byte[] data = "the bytes".getBytes();

        StoredRef ref = spool.write(new ByteArrayInputStream(data), id, meta(Category.VIDEO));

        assertThat(ref.storage()).isEqualTo(Storage.SPOOL);
        assertThat(ref.key()).isEqualTo("video/" + id);
        assertThat(ref.sizeBytes()).isEqualTo(data.length);
        assertThat(spool.size(ref.key())).isEqualTo(data.length);
        assertThat(spool.exists(ref.key())).isTrue();
        try (InputStream in = spool.read(ref.key())) {
            assertThat(in.readAllBytes()).isEqualTo(data);
        }
    }

    @Test
    void noPartFileIsLeftBehindOnSuccess() throws Exception {
        spool.write(new ByteArrayInputStream(new byte[100]), UUID.randomUUID().toString(), meta(Category.OUTAGE));

        try (Stream<Path> s = Files.walk(root)) {
            assertThat(s.filter(p -> p.toString().endsWith(".part"))).isEmpty();
        }
    }

    @Test
    void aWriteThatFailsHalfwayLeavesNothingAReaderCouldSee() throws Exception {
        String id = UUID.randomUUID().toString();
        InputStream failing = new InputStream() {
            int n;

            @Override
            public int read() throws IOException {
                if (n++ > 50) {
                    throw new IOException("client went away");
                }
                return 7;
            }
        };

        assertThatThrownBy(() -> spool.write(failing, id, meta(Category.VIDEO))).isInstanceOf(IOException.class);

        assertThat(spool.exists("video/" + id)).isFalse();
        assertThat(filesUnderRoot()).as("not even a .part file").isZero();
    }

    @Test
    void anEmptyFileIsFine() throws Exception {
        StoredRef ref = spool.write(new ByteArrayInputStream(new byte[0]), "abc", meta(Category.DOCUMENT));

        assertThat(ref.sizeBytes()).isZero();
        assertThat(spool.exists(ref.key())).isTrue();
    }

    @Test
    void readingAMissingFileGivesNull() throws Exception {
        assertThat(spool.read("video/" + UUID.randomUUID())).isNull();
    }

    @Test
    void deleteRemovesTheFileAndIsRepeatable() throws Exception {
        StoredRef ref = spool.write(new ByteArrayInputStream(new byte[10]), "k1", meta(Category.VIDEO));

        spool.delete(ref.key());
        spool.delete(ref.key());

        assertThat(spool.exists(ref.key())).isFalse();
    }

    @Test
    void aKeyCannotLeaveTheSpoolDirectory() {
        assertThatThrownBy(() -> spool.read("../outside")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> spool.delete("video/../../outside")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> spool.read("")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> spool.write(new ByteArrayInputStream(new byte[1]), "../../escape", meta(Category.VIDEO)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void healthIsTrueForAWritableDirectory() {
        assertThat(spool.health()).isTrue();
    }

    @Test
    void healthIsFalseWhenTheDirectoryCannotExist() throws Exception {
        Path blocker = Files.createFile(root.resolve("a-file"));

        assertThat(new SpoolStorage(blocker.resolve("inside").toString()).health()).isFalse();
    }
}
