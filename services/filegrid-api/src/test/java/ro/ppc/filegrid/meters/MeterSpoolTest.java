package ro.ppc.filegrid.meters;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;

class MeterSpoolTest {

    @TempDir
    Path root;

    private MeterSpool spool;

    static ObjectMapper mapper() {
        return new ObjectMapper().registerModule(new JavaTimeModule())
                .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);
    }

    static MeterReadingFile reading(String meter, int seq) {
        OffsetDateTime t = OffsetDateTime.parse("2026-11-14T10:00:00Z");
        return new MeterReadingFile(meter, "muntenia", "Prahova", 44.9, 26.0, t, seq, "3.2.1",
                List.of(new MeterReadingFile.Interval(t, 0.21, 229.4, List.of("tamper"))));
    }

    @BeforeEach
    void setUp() {
        spool = new MeterSpool(root.toString(), mapper());
    }

    @Test
    void aParkedReadingIsOnDiskAndComesBackIntact() throws Exception {
        assertThat(spool.put("RO-MT-1:2026-11-14T10:00:00Z:1", reading("RO-MT-1", 1), "trace-1")).isTrue();

        assertThat(spool.count()).isEqualTo(1);
        var claims = spool.claim(10);
        assertThat(claims).hasSize(1);
        var parked = claims.get(0).parked();
        assertThat(parked.idempotencyKey()).isEqualTo("RO-MT-1:2026-11-14T10:00:00Z:1");
        assertThat(parked.traceId()).isEqualTo("trace-1");
        assertThat(parked.reading().meterId()).isEqualTo("RO-MT-1");
        assertThat(parked.reading().periodStart().toInstant()).isEqualTo(reading("x", 1).periodStart().toInstant());
        assertThat(parked.reading().intervals().get(0).flags()).containsExactly("tamper");
    }

    @Test
    void aRetryOfAParkedReadingIsRecognisedAndNotParkedTwice() throws Exception {
        assertThat(spool.put("k1", reading("RO-MT-1", 1), null)).isTrue();

        assertThat(spool.contains("k1")).isTrue();
        assertThat(spool.put("k1", reading("RO-MT-1", 1), null)).isFalse();
        assertThat(spool.count()).isEqualTo(1);
        assertThat(spool.contains("k2")).isFalse();
    }

    @Test
    void aReadingBeingReplayedStillCountsAsParked() throws Exception {
        spool.put("k1", reading("RO-MT-1", 1), null);
        var claim = spool.claim(10).get(0);

        assertThat(spool.contains("k1")).as("a retry during replay is still a duplicate").isTrue();
        assertThat(spool.count()).isEqualTo(1);
        spool.done(claim);
        assertThat(spool.count()).isZero();
        assertThat(spool.contains("k1")).isFalse();
    }

    @Test
    void aReleasedReadingIsClaimedAgainNextRound() throws Exception {
        spool.put("k1", reading("RO-MT-1", 1), null);
        var first = spool.claim(10);
        assertThat(spool.claim(10)).as("a claimed reading is not handed out twice").isEmpty();

        spool.release(first.get(0));

        assertThat(spool.claim(10)).hasSize(1);
    }

    @Test
    void theFileNameDoesNotRevealTheKey() throws Exception {
        spool.put("RO-MT-000123:2026-11-14T10:00:00Z:42", reading("RO-MT-000123", 42), null);

        try (Stream<Path> s = Files.list(root.resolve("meter"))) {
            assertThat(s.map(p -> p.getFileName().toString())).allSatisfy(n -> {
                assertThat(n).doesNotContain("RO-MT");
                assertThat(n).matches("[0-9a-f]{64}\\.json");
            });
        }
    }

    @Test
    void aClaimLeftByADeadReplicaIsReleasedAfterAWhile() throws Exception {
        spool.put("k1", reading("RO-MT-1", 1), null);
        var claim = spool.claim(10).get(0);
        // The replica died: the claim is old.
        Files.setLastModifiedTime(claim.file(), FileTime.from(java.time.Instant.now().minus(10, ChronoUnit.MINUTES)));

        assertThat(spool.claim(10)).as("picked up again").hasSize(1);
    }

    @Test
    void aFreshClaimIsNotStolenByAnotherReplica() throws Exception {
        spool.put("k1", reading("RO-MT-1", 1), null);
        // An old reading, claimed just now: the claim time is what counts, not the age of the reading.
        Path parked = Files.list(root.resolve("meter")).findFirst().orElseThrow();
        Files.setLastModifiedTime(parked, FileTime.from(java.time.Instant.now().minus(1, ChronoUnit.HOURS)));
        spool.claim(10);

        assertThat(spool.claim(10)).isEmpty();
    }

    @Test
    void aFileThatIsNotAReadingIsKeptAsideNotRetriedForever() throws Exception {
        Files.createDirectories(root.resolve("meter"));
        Files.writeString(root.resolve("meter").resolve("0".repeat(64) + ".json"), "{ this is not json");

        assertThat(spool.claim(10)).isEmpty();

        assertThat(root.resolve("meter/rejected")).isDirectory();
        try (Stream<Path> s = Files.list(root.resolve("meter/rejected"))) {
            assertThat(s.count()).isEqualTo(1);
        }
    }

    @Test
    void anEmptySpoolIsFine() throws Exception {
        assertThat(spool.count()).isZero();
        assertThat(spool.claim(10)).isEmpty();
    }

    @Test
    void theOldestReadingsAreReplayedFirst() throws Exception {
        spool.put("k1", reading("RO-MT-1", 1), null);
        spool.put("k2", reading("RO-MT-2", 2), null);
        spool.put("k3", reading("RO-MT-3", 3), null);
        long base = System.currentTimeMillis() - 100_000;
        try (Stream<Path> s = Files.list(root.resolve("meter"))) {
            s.forEach(p -> {
                try {
                    var r = mapper().readTree(Files.readAllBytes(p)).get("reading").get("seq").asInt();
                    Files.setLastModifiedTime(p, FileTime.fromMillis(base + (4 - r) * 1000L)); // seq 3 oldest
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            });
        }

        var claims = spool.claim(2);

        assertThat(claims).extracting(c -> c.parked().reading().seq()).containsExactly(3, 2);
    }
}
