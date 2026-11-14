package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Against a real PostgreSQL: the COMTRADE metadata of an outage file lands in {@code files.metadata} as JSON that a view
 * can query, and a file with no metadata keeps the default {@code {}}. Skipped when Docker is not available.
 */
@Testcontainers(disabledWithoutDocker = true)
class FileMetadataDbTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:17-alpine");

    private static JdbcTemplate jdbc;
    private static FileRepository repo;

    @BeforeAll
    static void migrate() {
        DriverManagerDataSource ds = new DriverManagerDataSource(PG.getJdbcUrl(), PG.getUsername(), PG.getPassword());
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = new JdbcTemplate(ds);
        repo = new FileRepository(jdbc);
    }

    private static FileRow row(UUID id, String category) {
        return new FileRow(id, category, "s3", "filegrid-outage/" + id, 100, "a".repeat(64), "application/octet-stream",
                "fault.cfg", null, "banat", null, "dispatch", false, "stored", null, OffsetDateTime.now(), null);
    }

    @Test
    void theMetadataOfAnOutageFileCanBeQueriedByAView() {
        UUID id = UUID.randomUUID();
        byte[] cfg = String.join("\r\n", "PLOIESTI NORD,DFR-7,1999", "2,1A,1D", "1,Va,A,,V,0.01,0,0,-1,1,1,1,P", "1,TRIP,,,0",
                "50", "1", "4000,200", "14/11/2026,10:15:30.000000", "14/11/2026,10:15:30.250000", "ASCII", "").getBytes(StandardCharsets.UTF_8);
        String json = ComtradeCfg.metadataJson(cfg, cfg.length).orElseThrow();

        repo.insert(row(id, "outage"), null, null, json);

        var m = jdbc.queryForMap("SELECT metadata ->> 'station' AS station, (metadata ->> 'faultTime')::timestamptz AS fault, "
                + "(metadata ->> 'recordingMs')::int AS ms FROM files WHERE id = ?::uuid", id.toString());
        assertThat(m.get("station")).isEqualTo("PLOIESTI NORD");
        assertThat(((java.sql.Timestamp) m.get("fault")).toInstant()).isEqualTo(java.time.Instant.parse("2026-11-14T10:15:30.250Z"));
        assertThat(m.get("ms")).isEqualTo(50);
    }

    @Test
    void aFileWithNoMetadataKeepsTheEmptyObject() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();

        repo.insert(row(a, "outage"), null, null);
        repo.insert(row(b, "outage"), null, null, null);

        for (UUID id : new UUID[] {a, b}) {
            assertThat(jdbc.queryForObject("SELECT metadata::text FROM files WHERE id = ?::uuid", String.class, id.toString()))
                    .isEqualTo("{}");
        }
    }
}
