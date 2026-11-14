package ro.ppc.filegrid.spool;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.storage.CountingInputStream;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * The fallback of last resort: a directory on a volume that survives container restarts.
 * A file is {@code <root>/<category>/<file id>}; the key used everywhere is
 * {@code <category>/<file id>}.
 *
 * <p>A write is durable before it returns: the bytes go to {@code .part}, are forced to disk,
 * and only then renamed into place, so a crash leaves either the whole file or nothing a
 * reader can see. The caller acknowledges the upload only after this returns.
 */
@Component
public class SpoolStorage implements StorageAdapter {

    private static final Logger log = LoggerFactory.getLogger(SpoolStorage.class);
    private static final long MIN_FREE_BYTES = 64L * 1024 * 1024;

    private final Path root;

    public SpoolStorage(@Value("${filegrid.spool.dir:/var/filegrid/spool}") String dir) {
        this.root = Path.of(dir).toAbsolutePath().normalize();
    }

    @Override
    public Storage kind() {
        return Storage.SPOOL;
    }

    @Override
    public StoredRef write(InputStream body, String key, WriteMeta meta) throws IOException {
        String relative = meta.category().slug() + "/" + key;
        Path target = resolve(relative);
        Files.createDirectories(target.getParent());
        Path part = target.resolveSibling(target.getFileName() + ".part");
        CountingInputStream counted = new CountingInputStream(body);
        try (FileChannel channel = FileChannel.open(part, StandardOpenOption.CREATE,
                StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING);
             OutputStream out = Channels.newOutputStream(channel)) {
            counted.transferTo(out);
            out.flush();
            channel.force(true); // on disk, not just in the page cache
        } catch (IOException | RuntimeException e) {
            Files.deleteIfExists(part);
            throw e;
        }
        Files.move(part, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        syncDirectory(target.getParent());
        return new StoredRef(Storage.SPOOL, relative, counted.count());
    }

    @Override
    public InputStream read(String key) throws IOException {
        try {
            return Files.newInputStream(resolve(key));
        } catch (NoSuchFileException e) {
            return null;
        }
    }

    public long size(String key) throws IOException {
        return Files.size(resolve(key));
    }

    public boolean exists(String key) {
        return Files.isRegularFile(resolve(key));
    }

    @Override
    public void delete(String key) throws IOException {
        Files.deleteIfExists(resolve(key));
    }

    @Override
    public boolean health() {
        try {
            Files.createDirectories(root);
            return Files.isWritable(root) && Files.getFileStore(root).getUsableSpace() > MIN_FREE_BYTES;
        } catch (IOException e) {
            return false;
        }
    }

    /** Keys come from our own database, but a key must never be able to leave the spool root. */
    private Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root) || p.equals(root)) {
            throw new IllegalArgumentException("spool key outside the spool directory");
        }
        return p;
    }

    /** Makes the rename itself survive a crash. Best effort: not every file system allows it. */
    private static void syncDirectory(Path dir) {
        try (FileChannel ch = FileChannel.open(dir, StandardOpenOption.READ)) {
            ch.force(true);
        } catch (IOException | UnsupportedOperationException e) {
            log.debug("could not sync the spool directory");
        }
    }
}
