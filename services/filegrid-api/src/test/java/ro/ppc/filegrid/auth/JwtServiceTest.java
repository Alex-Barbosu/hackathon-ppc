package ro.ppc.filegrid.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.domain.Role;

class JwtServiceTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private final ObjectMapper json = new ObjectMapper();
    private TestClock clock;
    private JwtService jwt;

    @BeforeEach
    void setUp() {
        clock = new TestClock();
        jwt = new JwtService(SECRET, 60, json, clock);
    }

    @Test
    void roundTripsUsernameAndRole() {
        var issued = jwt.issue("dispatch", Role.DISPATCH);

        var principal = jwt.verify(issued.token());

        assertThat(principal).contains(new AuthPrincipal("dispatch", Role.DISPATCH));
        assertThat(issued.expiresAt().toInstant()).isEqualTo(clock.instant().plus(Duration.ofMinutes(60)));
    }

    @Test
    void rejectsExpiredToken() {
        var token = jwt.issue("admin", Role.ADMIN).token();
        clock.advance(Duration.ofMinutes(61));

        assertThat(jwt.verify(token)).isEmpty();
    }

    @Test
    void rejectsTokenSignedWithAnotherSecret() {
        var other = new JwtService("ffffffffffffffffffffffffffffffff", 60, json, clock);

        assertThat(jwt.verify(other.issue("admin", Role.ADMIN).token())).isEmpty();
    }

    @Test
    void rejectsTamperedPayload() {
        var parts = jwt.issue("field", Role.FIELD).token().split("\\.");
        // Same signature, payload promoted to admin.
        String forged = B64.encodeToString(
                "{\"sub\":\"field\",\"role\":\"admin\",\"exp\":9999999999}".getBytes(StandardCharsets.UTF_8));

        assertThat(jwt.verify(parts[0] + "." + forged + "." + parts[2])).isEmpty();
    }

    @Test
    void rejectsAlgNone() {
        String header = B64.encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = B64.encodeToString(
                "{\"sub\":\"admin\",\"role\":\"admin\",\"exp\":9999999999}".getBytes(StandardCharsets.UTF_8));

        assertThat(jwt.verify(header + "." + payload + ".")).isEmpty();
    }

    @Test
    void rejectsGarbage() {
        assertThat(jwt.verify("")).isEmpty();
        assertThat(jwt.verify("a.b")).isEmpty();
        assertThat(jwt.verify("not.a.jwt")).isEmpty();
        assertThat(jwt.verify("%%%.%%%.%%%")).isEmpty();
    }

    @Test
    void refusesToStartWithoutAStrongSecret() {
        assertThatThrownBy(() -> new JwtService("", 60, json, clock)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new JwtService("short", 60, json, clock)).isInstanceOf(IllegalStateException.class);
    }
}
