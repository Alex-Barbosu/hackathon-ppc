package ro.ppc.filegrid.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DownloadTokenServiceTest {

    private static final String SECRET = "unit-test-signing-key-not-a-real-secret";

    private final UUID file = UUID.randomUUID();
    private TestClock clock;
    private DownloadTokenService tokens;

    @BeforeEach
    void setUp() {
        clock = new TestClock();
        tokens = new DownloadTokenService(SECRET, clock);
    }

    @Test
    void validForItsOwnFileAndReturnsTheUser() {
        var link = tokens.mint(file, "connections");

        assertThat(tokens.verify(link.token(), file)).contains("connections");
        assertThat(link.expiresAt().toInstant()).isEqualTo(clock.instant().plusSeconds(60));
    }

    @Test
    void notValidForAnotherFile() {
        var link = tokens.mint(file, "connections");

        assertThat(tokens.verify(link.token(), UUID.randomUUID())).isEmpty();
    }

    @Test
    void expiresAfterSixtySeconds() {
        var link = tokens.mint(file, "admin");
        clock.advance(Duration.ofSeconds(59));
        assertThat(tokens.verify(link.token(), file)).isPresent();

        clock.advance(Duration.ofSeconds(2));
        assertThat(tokens.verify(link.token(), file)).isEmpty();
    }

    @Test
    void rejectsEditedUsernameOrExpiry() {
        String[] p = tokens.mint(file, "field").token().split("\\.");
        String otherUser = java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString("admin".getBytes());

        assertThat(tokens.verify(p[0] + "." + p[1] + "." + otherUser + "." + p[3], file)).isEmpty();
        assertThat(tokens.verify(p[0] + "." + (Long.parseLong(p[1]) + 3600) + "." + p[2] + "." + p[3], file))
                .isEmpty();
    }

    @Test
    void rejectsGarbage() {
        assertThat(tokens.verify("", file)).isEmpty();
        assertThat(tokens.verify("v1.1.2", file)).isEmpty();
        assertThat(tokens.verify("v2.1.a.b", file)).isEmpty();
        assertThat(tokens.verify("v1.x.a.b", file)).isEmpty();
    }
}
