package ro.ppc.filegrid.meters;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import ro.ppc.filegrid.meters.dto.MeterReadingFile;
import ro.ppc.filegrid.meters.dto.MeterReadingFile.Interval;

/**
 * Against a real PostgreSQL (the production schema, built by the Flyway migrations): a meter reading and its
 * intervals are written together, a retry never duplicates either, and the V104 backfill fills the intervals of readings
 * stored before. Skipped when Docker is not available.
 */
@Testcontainers(disabledWithoutDocker = true)
class MeterIntervalsDbTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17-alpine");

    private static final ObjectMapper JSON = new ObjectMapper().registerModule(new JavaTimeModule())
            .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    private static final OffsetDateTime T0 = OffsetDateTime.parse("2026-11-14T10:00:00Z");

    private static JdbcTemplate jdbc;
    private static TransactionTemplate tx;
    private static MeterRepository repo;

    @BeforeAll
    static void migrate() {
        DriverManagerDataSource ds = new DriverManagerDataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = new JdbcTemplate(ds);
        tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        repo = new MeterRepository(jdbc);
    }

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM meter_intervals");
        jdbc.update("DELETE FROM meter_readings");
    }

    private static MeterReadingFile reading(String meter, int seq, Interval... intervals) {
        return new MeterReadingFile(meter, "banat", "Timis", 45.75, 21.23, T0, seq, "3.2.1", List.of(intervals));
    }

    private static Interval at(int minutes, double kwh, Double voltage, String... flags) {
        return new Interval(T0.plusMinutes(minutes), kwh, voltage, flags.length == 0 ? null : List.of(flags));
    }

    private boolean ingest(String key, MeterReadingFile r) throws Exception {
        String raw = JSON.writeValueAsString(r);
        return Boolean.TRUE.equals(tx.execute(status -> repo.insertIfNew(key, r, raw, "trace")));
    }

    private long count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
    }

    @Test
    void theSameReadingSentTwiceLeavesOneRowInEachTable() throws Exception {
        MeterReadingFile r = reading("RO-MT-1", 7, at(0, 0.21, 229.4), at(15, 0.25, 231.0, "tamper"), at(30, 0.19, null));

        assertThat(ingest("key-1", r)).as("first time").isTrue();
        assertThat(ingest("key-1", r)).as("the retry").isFalse();
        assertThat(ingest("key-1", r)).as("and again").isFalse();

        assertThat(count("meter_readings")).isEqualTo(1);
        assertThat(count("meter_intervals")).isEqualTo(3);
    }

    @Test
    void theReadingIsStoredWithItsRegionCountyAndPosition() throws Exception {
        ingest("key-2", reading("RO-MT-2", 1, at(0, 0.3, 230.0)));

        var row = jdbc.queryForMap("SELECT region, county, lat, lon FROM meter_readings WHERE meter_id = 'RO-MT-2'");
        assertThat(row).containsEntry("region", "banat").containsEntry("county", "Timis")
                .containsEntry("lat", 45.75).containsEntry("lon", 21.23);
    }

    @Test
    void intervalsKeepTheirValuesVoltageAndFlags() throws Exception {
        ingest("key-3", reading("RO-MT-3", 1, at(0, 0.21, 229.4), at(15, 12.3456, 231.0, "tamper", "clock_drift"), at(30, 0.1, null)));

        var rows = jdbc.queryForList("SELECT kwh, voltage, flags::text AS flags FROM meter_intervals "
                + "WHERE meter_id = 'RO-MT-3' ORDER BY ts");
        assertThat(rows).hasSize(3);
        assertThat(rows.get(0)).containsEntry("kwh", new java.math.BigDecimal("0.2100"))
                .containsEntry("voltage", new java.math.BigDecimal("229.40")).containsEntry("flags", "{}");
        assertThat(rows.get(1)).containsEntry("kwh", new java.math.BigDecimal("12.3456"))
                .containsEntry("flags", "{tamper,clock_drift}");
        assertThat(rows.get(2).get("voltage")).isNull();
    }

    @Test
    void aRetryWithAnotherKeyButTheSameReadingStillAddsNothing() throws Exception {
        MeterReadingFile r = reading("RO-MT-4", 9, at(0, 0.5, 230.0));
        assertThat(ingest("key-4a", r)).isTrue();
        assertThat(ingest("key-4b", r)).isFalse();

        assertThat(count("meter_readings")).isEqualTo(1);
        assertThat(count("meter_intervals")).isEqualTo(1);
    }

    @Test
    void anIntervalAlreadyStoredForTheMeterAndTimeIsNotDuplicatedByANewReading() throws Exception {
        ingest("key-5a", reading("RO-MT-5", 1, at(0, 0.5, 230.0), at(15, 0.6, 230.0)));
        // A new reading (new seq) that overlaps: the interval at +15 is already there.
        ingest("key-5b", reading("RO-MT-5", 2, at(15, 9.9, 230.0), at(30, 0.7, 230.0)));

        assertThat(count("meter_readings")).isEqualTo(2);
        assertThat(count("meter_intervals")).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT kwh FROM meter_intervals WHERE meter_id = 'RO-MT-5' AND ts = ?",
                java.math.BigDecimal.class, java.sql.Timestamp.from(T0.plusMinutes(15).toInstant())))
                .as("the first value stays").isEqualByComparingTo("0.6");
    }

    @Test
    void theTwoInsertsAreOneTransaction() throws Exception {
        MeterReadingFile r = reading("RO-MT-6", 1, at(0, 0.5, 230.0));
        String raw = JSON.writeValueAsString(r);

        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            repo.insertIfNew("key-6", r, raw, "trace");
            throw new IllegalStateException("something after the insert failed");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(count("meter_readings")).as("the reading is rolled back").isZero();
        assertThat(count("meter_intervals")).as("and so are its intervals").isZero();
    }

    @Test
    void aValueTheColumnCannotHoldNeverStopsTheReading() throws Exception {
        MeterReadingFile r = reading("RO-MT-7", 1,
                at(0, 0.5, 230.0),
                at(15, 5_000_000.0, 230.0),                  // kwh too big: the interval is skipped
                at(30, 0.4, 123_456.0),                       // voltage too big: stored as null
                new Interval(null, 0.3, 230.0, null),         // no timestamp: skipped
                new Interval(T0.plusMinutes(45), null, 230.0, null)); // no kwh: skipped

        assertThat(ingest("key-7", r)).isTrue();

        assertThat(count("meter_readings")).isEqualTo(1);
        assertThat(count("meter_intervals")).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT voltage FROM meter_intervals WHERE meter_id = 'RO-MT-7' AND kwh = 0.4",
                java.math.BigDecimal.class)).isNull();
        assertThat(jdbc.queryForObject("SELECT jsonb_array_length(raw -> 'intervals') FROM meter_readings "
                + "WHERE meter_id = 'RO-MT-7'", Integer.class)).as("the original is kept whole in raw").isEqualTo(5);
    }

    @Test
    void aReadingWithNoIntervalsIsStillStored() throws Exception {
        MeterReadingFile r = new MeterReadingFile("RO-MT-8", "banat", "Timis", null, null, T0, 1, null, null);

        assertThat(ingest("key-8", r)).isTrue();
        assertThat(count("meter_readings")).isEqualTo(1);
        assertThat(count("meter_intervals")).isZero();
    }

    // ------------------------------------------------------------------ the V104 backfill

    @Test
    void theBackfillFillsTheIntervalsOfReadingsStoredBefore() throws Exception {
        // A database as it was before V104, with readings whose raw holds the intervals.
        String name = "before_" + UUID.randomUUID().toString().replace("-", "");
        jdbc.execute("CREATE DATABASE " + name);
        String url = PG.getJdbcUrl().replaceFirst("/[^/?]+(\\?|$)", "/" + name + "$1");
        DriverManagerDataSource ds = new DriverManagerDataSource(url, PG.getUsername(), PG.getPassword());
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").target("103").load().migrate();
        JdbcTemplate old = new JdbcTemplate(ds);

        old.update("INSERT INTO meter_readings (meter_id, region, county, period_start, seq, idempotency_key, raw) "
                + "VALUES ('M-1','banat','Timis', now(), 1, 'k1', ?::jsonb)", """
                {"meterId":"M-1","intervals":[
                  {"ts":"2026-11-14T10:00:00Z","kwh":0.21,"voltage":229.4,"flags":["tamper"]},
                  {"ts":"2026-11-14T10:15:00Z","kwh":0.25,"voltage":null,"flags":null},
                  {"ts":"2026-11-14T10:30:00Z","kwh":99999999,"voltage":230.0},
                  {"ts":"2026-11-14T10:45:00Z","kwh":"abc"},
                  {"kwh":0.3}]}""");
        old.update("INSERT INTO meter_readings (meter_id, region, county, period_start, seq, idempotency_key, raw) "
                + "VALUES ('M-2','muntenia','Prahova', now(), 1, 'k2', ?::jsonb)", "{\"meterId\":\"M-2\",\"intervals\":null}");
        old.update("INSERT INTO meter_readings (meter_id, region, county, period_start, seq, idempotency_key, raw) "
                + "VALUES ('M-3','muntenia','Prahova', now(), 1, 'k3', ?::jsonb)", "{\"meterId\":\"M-3\"}");
        // One interval is there already, with its own value: the backfill must leave it as it is.
        old.update("INSERT INTO meter_intervals (meter_id, ts, kwh) VALUES ('M-1', '2026-11-14T10:00:00Z', 7)");

        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();

        var rows = old.queryForList("SELECT ts, kwh, voltage, flags::text AS flags FROM meter_intervals "
                + "WHERE meter_id = 'M-1' ORDER BY ts");
        assertThat(rows).as("the two that fit; the other three are skipped, none stops the migration").hasSize(2);
        assertThat(rows.get(0).get("kwh")).as("an existing row is not changed").isEqualTo(new java.math.BigDecimal("7.0000"));
        assertThat(rows.get(1)).containsEntry("kwh", new java.math.BigDecimal("0.2500")).containsEntry("flags", "{}");
        assertThat(rows.get(1).get("voltage")).isNull();
        assertThat(old.queryForObject("SELECT count(*) FROM meter_intervals", Long.class)).isEqualTo(2);

        // Run the same statements again: nothing changes.
        Path sql = Path.of("src/main/resources/db/migration/V104__backfill_meter_intervals.sql");
        old.execute(Files.readString(sql, StandardCharsets.UTF_8));
        assertThat(old.queryForObject("SELECT count(*) FROM meter_intervals", Long.class)).isEqualTo(2);
    }
}
