package ro.ppc.filegrid.auth;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.domain.Role;

/**
 * POST /api/v1/auth/login (contracts/openapi.yaml). The demo users are the four human roles,
 * each named after its role, all sharing the password in DEMO_PASSWORD. The username decides
 * the role, so there is no user table to keep in sync.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final Set<Role> DEMO_ROLES =
            Set.of(Role.FIELD, Role.DISPATCH, Role.CONNECTIONS, Role.ADMIN);

    private final JwtService jwt;
    private final String demoPassword;

    public AuthController(JwtService jwt, @Value("${DEMO_PASSWORD:}") String demoPassword) {
        this.jwt = jwt;
        this.demoPassword = demoPassword;
    }

    public record LoginRequest(@NotBlank @Size(max = 100) String username,
                               @NotBlank @Size(max = 200) String password) {
    }

    /** Session schema. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Session(String token, String role, String username, OffsetDateTime expiresAt) {
    }

    @PostMapping("/login")
    public Session login(@Valid @RequestBody LoginRequest body) {
        // An unset DEMO_PASSWORD must lock everyone out, not let an empty password in.
        boolean passwordOk = !demoPassword.isEmpty() && Hashing.secretsEqual(body.password(), demoPassword);
        Optional<Role> role = Role.fromWire(body.username()).filter(DEMO_ROLES::contains);
        // One message for both cases so the response does not reveal which usernames exist.
        if (!passwordOk || role.isEmpty()) {
            throw ApiException.unauthorized("invalid username or password");
        }
        JwtService.Issued issued = jwt.issue(body.username(), role.get());
        return new Session(issued.token(), role.get().wire(), body.username(), issued.expiresAt());
    }
}
