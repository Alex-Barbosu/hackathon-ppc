package ro.ppc.filegrid.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.domain.Role;

/**
 * Self-issued HS256 JWTs signed with JWT_SECRET. Written with the JDK's HMAC instead of a
 * JWT library: the only token we accept is one we signed ourselves, so there is no key
 * lookup, no algorithm negotiation and nothing to parse beyond three fixed claims.
 *
 * <p>The header's {@code alg} must be exactly HS256 and the signature is always recomputed
 * with HS256, so {@code alg: none} and algorithm-confusion tokens are rejected.
 */
@Service
public class JwtService {

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder D64 = Base64.getUrlDecoder();
    private static final String HEADER =
            B64.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));

    private final byte[] key;
    private final long ttlSeconds;
    private final ObjectMapper json;
    private final Clock clock;

    @Autowired
    public JwtService(@Value("${JWT_SECRET:}") String secret,
                      @Value("${filegrid.auth.ttl-minutes:480}") long ttlMinutes,
                      ObjectMapper json) {
        this(secret, ttlMinutes, json, Clock.systemUTC());
    }

    JwtService(String secret, long ttlMinutes, ObjectMapper json, Clock clock) {
        // Fail at startup rather than sign tokens with an empty or guessable key.
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException("JWT_SECRET must be set to at least 32 characters");
        }
        this.key = secret.getBytes(StandardCharsets.UTF_8);
        this.ttlSeconds = ttlMinutes * 60;
        this.json = json;
        this.clock = clock;
    }

    public record Issued(String token, OffsetDateTime expiresAt) {
    }

    public Issued issue(String username, Role role) {
        Instant now = clock.instant();
        Instant exp = now.plusSeconds(ttlSeconds);
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", username);
        claims.put("role", role.wire());
        claims.put("iat", now.getEpochSecond());
        claims.put("exp", exp.getEpochSecond());
        try {
            String payload = B64.encodeToString(json.writeValueAsBytes(claims));
            String signingInput = HEADER + "." + payload;
            return new Issued(signingInput + "." + sign(signingInput),
                    exp.atOffset(ZoneOffset.UTC));
        } catch (Exception e) {
            throw new IllegalStateException("cannot issue token", e);
        }
    }

    /** Returns the caller if the token is well-formed, signed by us and not expired. */
    public Optional<AuthPrincipal> verify(String token) {
        try {
            String[] parts = token.split("\\.", -1);
            if (parts.length != 3) {
                return Optional.empty();
            }
            JsonNode header = json.readTree(D64.decode(parts[0]));
            if (!"HS256".equals(header.path("alg").asText())) {
                return Optional.empty();
            }
            byte[] given = D64.decode(parts[2]);
            byte[] expected = Hashing.hmacSha256(key,
                    (parts[0] + "." + parts[1]).getBytes(StandardCharsets.UTF_8));
            if (!MessageDigest.isEqual(expected, given)) {
                return Optional.empty();
            }
            JsonNode claims = json.readTree(D64.decode(parts[1]));
            if (!claims.hasNonNull("exp") || claims.get("exp").asLong() <= clock.instant().getEpochSecond()) {
                return Optional.empty();
            }
            String sub = claims.path("sub").asText("");
            Optional<Role> role = Role.fromWire(claims.path("role").asText(null));
            // Only the five contract roles may come from a JWT; download-link is internal.
            if (sub.isEmpty() || role.isEmpty() || role.get() == Role.DOWNLOAD_LINK) {
                return Optional.empty();
            }
            return Optional.of(new AuthPrincipal(sub, role.get()));
        } catch (Exception e) {
            // Malformed base64/JSON is an invalid token, never a 500.
            return Optional.empty();
        }
    }

    private String sign(String signingInput) {
        return B64.encodeToString(Hashing.hmacSha256(key, signingInput.getBytes(StandardCharsets.UTF_8)));
    }
}
