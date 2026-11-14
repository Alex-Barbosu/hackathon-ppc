package ro.ppc.filegrid.meters;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;

/**
 * Where meter readings wait while the database is down (the policy's meter fallback is spool).
 *
 * <p>The database is the meter primary, so the spool cannot use it as an index; each reading is
 * one small file. The acknowledgement to the meter is only sent after the file is on disk, which
 * is what keeps "never lost" true through a database outage. The file name is a hash of the
 * Idempotency-Key, so a meter retrying while the database is still down finds its reading already
 * parked and gets "duplicate" instead of a second copy.
 *
 * <p>A replica takes a file by renaming it to {@code .claim}, which only one of them can do. A
 * claim left behind by a replica that died is released after {@link #STALE_CLAIM}.
 */
@Component
public class MeterSpool {

    private static final Logger log = LoggerFactory.getLogger(MeterSpool.class);
    static final Duration STALE_CLAIM = Duration.ofMinutes(5);

    private final Path dir;
    private final Path rejected;
    private final ObjectMapper json;

    public MeterSpool(@Value("${filegrid.spool.dir:/var/filegrid/spool}") String root, ObjectMapper json) {
        this.dir = Path.of(root).toAbsolutePath().normalize().resolve("meter");
        this.rejected = dir.resolve("rejected");
        this.json = json;
    }

    /** What is stored in a spool file. */
    public record Parked(String idempotencyKey, String traceId, MeterReadingFile reading) {
    }

    /** A claimed file: read it, then {@link #done} or {@link #release}. */
    public record Claim(Path file, Parked parked) {
    }

    private Path fileFor(String idempotencyKey) {
        return dir.resolve(Hashing.hex(Hashing.sha256().digest(idempotencyKey.getBytes(StandardCharsets.UTF_8))) + ".json");
    }

    public boolean contains(String idempotencyKey) {
        Path f = fileFor(idempotencyKey);
        return Files.exists(f) || Files.exists(f.resolveSibling(f.getFileName() + ".claim"));
    }

    /**
     * Parks a reading durably. Returns false if this key is already parked (a retry), true if this
     * call parked it. Only returns once the file is flushed to disk.
     */
    public boolean put(String idempotencyKey, MeterReadingFile reading, String traceId) throws IOException {
        if (contains(idempotencyKey)) {
            return false;
        }
        Files.createDirectories(dir);
        Path target = fileFor(idempotencyKey);
        Path part = target.resolveSibling(target.getFileName() + ".part");
        byte[] bytes = json.writeValueAsBytes(new Parked(idempotencyKey, traceId, reading));
        try (FileChannel ch = FileChannel.open(part, StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {
            ch.write(java.nio.ByteBuffer.wrap(bytes));
            ch.force(true);
        }
        Files.move(part, target, StandardCopyOption.ATOMIC_MOVE);
        try (FileChannel d = FileChannel.open(dir, StandardOpenOption.READ)) {
            d.force(true);
        } catch (IOException | UnsupportedOperationException e) {
            log.debug("could not sync the meter spool directory");
        }
        return true;
    }

    /** How many readings are waiting (parked or being replayed). */
    public long count() {
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().endsWith(".json")
                    || p.getFileName().toString().endsWith(".claim")).count();
        } catch (NoSuchFileException e) {
            return 0;
        } catch (IOException e) {
            return 0;
        }
    }

    /** Claims up to {@code limit} parked readings, oldest first. A file that is not valid goes to {@code rejected/}. */
    public List<Claim> claim(int limit) throws IOException {
        releaseStaleClaims();
        List<Path> candidates;
        try (Stream<Path> s = Files.list(dir)) {
            candidates = s.filter(p -> p.getFileName().toString().endsWith(".json"))
                    .sorted(java.util.Comparator.comparing(MeterSpool::modified)).limit(limit).toList();
        } catch (NoSuchFileException e) {
            return List.of();
        }
        List<Claim> out = new ArrayList<>();
        for (Path file : candidates) {
            Path claimed = file.resolveSibling(file.getFileName() + ".claim");
            try {
                Files.move(file, claimed, StandardCopyOption.ATOMIC_MOVE);
            } catch (NoSuchFileException e) {
                continue; // another replica took it
            }
            // A rename keeps the old timestamp, which would make a fresh claim look stale to another replica.
            Files.setLastModifiedTime(claimed, java.nio.file.attribute.FileTime.from(Instant.now()));
            try {
                out.add(new Claim(claimed, json.readValue(Files.readAllBytes(claimed), Parked.class)));
            } catch (IOException e) {
                // Not a reading we can ever insert. Keep it for a person to look at instead of retrying forever.
                Files.createDirectories(rejected);
                Files.move(claimed, rejected.resolve(file.getFileName()), StandardCopyOption.REPLACE_EXISTING);
                log.error("unreadable meter spool file moved to rejected/ name={}", file.getFileName());
            }
        }
        return out;
    }

    /** The reading was inserted: forget it. */
    public void done(Claim claim) throws IOException {
        Files.deleteIfExists(claim.file());
    }

    /** The database will never accept this reading: keep it for a person to look at, do not retry it. */
    public void reject(Claim claim) throws IOException {
        Files.createDirectories(rejected);
        String name = claim.file().getFileName().toString();
        Files.move(claim.file(), rejected.resolve(name.substring(0, name.length() - ".claim".length())),
                StandardCopyOption.REPLACE_EXISTING);
        log.error("meter reading moved to rejected/ after the database refused it");
    }

    /** The reading could not be inserted yet: put it back for the next round. */
    public void release(Claim claim) throws IOException {
        String name = claim.file().getFileName().toString();
        Files.move(claim.file(), claim.file().resolveSibling(name.substring(0, name.length() - ".claim".length())),
                StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private void releaseStaleClaims() throws IOException {
        Instant cutoff = Instant.now().minus(STALE_CLAIM);
        try (Stream<Path> s = Files.list(dir)) {
            for (Path p : s.filter(x -> x.getFileName().toString().endsWith(".claim")).toList()) {
                if (modified(p).toInstant().isBefore(cutoff)) {
                    release(new Claim(p, null));
                }
            }
        } catch (NoSuchFileException e) {
            // nothing parked yet
        }
    }

    private static java.nio.file.attribute.FileTime modified(Path p) {
        try {
            return Files.getLastModifiedTime(p);
        } catch (IOException e) {
            return java.nio.file.attribute.FileTime.fromMillis(0);
        }
    }
}
