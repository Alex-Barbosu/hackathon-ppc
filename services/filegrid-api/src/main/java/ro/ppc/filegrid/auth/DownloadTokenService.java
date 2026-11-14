package ro.ppc.filegrid.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.common.Hashing;

/**
 * 60-second download tokens (contracts: POST /files/{id}/download-link). A token is
 * {@code v1.<expiryEpoch>.<username>.<signature>} where the signature is an HMAC with
 * JWT_SECRET over the file id, username and expiry. Binding the file id means a token cannot
 * be replayed for another file; the short life limits what a copy in a proxy log is worth.
 * The message has a fixed prefix so a download signature can never be mistaken for a JWT one.
 */
@Service
public class DownloadTokenService {

    public static final long TTL_SECONDS = 60;

    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder D64 = Base64.getUrlDecoder();

    private final byte[] key;
    private final Clock clock;

    @Autowired
    public DownloadTokenService(@Value("${JWT_SECRET:}") String secret) {
        this(secret, Clock.systemUTC());
    }

    DownloadTokenService(String secret, Clock clock) {
        if (secret == null || secret.length() < 32) {
            throw new IllegalStateException("JWT_SECRET must be set to at least 32 characters");
        }
        this.key = secret.getBytes(StandardCharsets.UTF_8);
        this.clock = clock;
    }

    public record Link(String token, OffsetDateTime expiresAt) {
    }

    public Link mint(UUID fileId, String username) {
        Instant exp = clock.instant().plusSeconds(TTL_SECONDS);
        long expEpoch = exp.getEpochSecond();
        String token = "v1." + expEpoch + "." + B64.encodeToString(username.getBytes(StandardCharsets.UTF_8))
                + "." + B64.encodeToString(sign(fileId, username, expEpoch));
        return new Link(token, exp.atOffset(ZoneOffset.UTC));
    }

    /** Returns the username the token was minted for, if it is valid for this file now. */
    public Optional<String> verify(String token, UUID fileId) {
        try {
            String[] p = token.split("\\.", -1);
            if (p.length != 4 || !"v1".equals(p[0])) {
                return Optional.empty();
            }
            long expEpoch = Long.parseLong(p[1]);
            if (expEpoch <= clock.instant().getEpochSecond()) {
                return Optional.empty();
            }
            String username = new String(D64.decode(p[2]), StandardCharsets.UTF_8);
            byte[] given = D64.decode(p[3]);
            if (!MessageDigest.isEqual(sign(fileId, username, expEpoch), given)) {
                return Optional.empty();
            }
            return Optional.of(username);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private byte[] sign(UUID fileId, String username, long expEpoch) {
        String message = "filegrid-download-v1|" + fileId + "|" + username + "|" + expEpoch;
        return Hashing.hmacSha256(key, message.getBytes(StandardCharsets.UTF_8));
    }
}
