package ro.ppc.filegrid.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.tracing.Tracer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import ro.ppc.filegrid.common.ApiError;
import ro.ppc.filegrid.common.Hashing;
import ro.ppc.filegrid.domain.Role;

/**
 * The single door for authentication. Credentials accepted, in order:
 * <ol>
 *   <li>{@code Authorization: Bearer <METER_DEVICE_TOKEN>}: the meter devices' static token.
 *   <li>{@code Authorization: Bearer <JWT>}: a session from POST /auth/login.
 *   <li>{@code ?token=} on {@code GET /files/{id}/content}: a 60 s download link token.
 * </ol>
 * Failures are written here as the Error schema because a filter runs before the controller
 * advice. Neither tokens nor passwords are ever logged.
 */
@Component
@Order(1)
public class AuthFilter extends OncePerRequestFilter {

    public static final String PRINCIPAL_ATTR = "filegrid.principal";

    private final JwtService jwt;
    private final DownloadTokenService downloadTokens;
    private final String deviceToken;
    private final ObjectMapper json;
    private final Tracer tracer;

    public AuthFilter(JwtService jwt, DownloadTokenService downloadTokens,
                      @Value("${METER_DEVICE_TOKEN:}") String deviceToken,
                      ObjectMapper json, Tracer tracer) {
        this.jwt = jwt;
        this.downloadTokens = downloadTokens;
        this.deviceToken = deviceToken;
        this.json = json;
        this.tracer = tracer;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        // The servlet path is what Spring MVC maps on, after the container has resolved "..".
        // Using the raw URI here would let /api/v1/meter-readings/../files pass the
        // device-token check and then be routed to /files.
        String path = request.getServletPath() + (request.getPathInfo() == null ? "" : request.getPathInfo());

        if (AccessRules.isPublic(path)) {
            chain.doFilter(request, response);
            return;
        }

        Optional<AuthPrincipal> principal = authenticate(request, path);
        if (principal.isEmpty()) {
            response.setHeader("WWW-Authenticate", "Bearer");
            writeError(response, HttpStatus.UNAUTHORIZED, ApiError.Code.UNAUTHORIZED,
                    "missing or invalid credentials");
            return;
        }
        if (!AccessRules.allowed(principal.get().role(), request.getMethod(), path)) {
            writeError(response, HttpStatus.FORBIDDEN, ApiError.Code.FORBIDDEN,
                    "this credential cannot use this route");
            return;
        }
        request.setAttribute(PRINCIPAL_ATTR, principal.get());
        chain.doFilter(request, response);
    }

    private Optional<AuthPrincipal> authenticate(HttpServletRequest request, String path) {
        String header = request.getHeader("Authorization");
        if (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            String token = header.substring(7).trim();
            if (!token.isEmpty()) {
                if (!deviceToken.isEmpty() && Hashing.secretsEqual(token, deviceToken)) {
                    return Optional.of(new AuthPrincipal("meter-device", Role.METER_DEVICE));
                }
                Optional<AuthPrincipal> session = jwt.verify(token);
                if (session.isPresent()) {
                    return session;
                }
            }
        }
        // A download link is only honoured on its own file's content route.
        String fileId = AccessRules.contentFileId(path);
        String linkToken = request.getParameter("token");
        if (fileId != null && "GET".equals(request.getMethod()) && linkToken != null) {
            return downloadTokens.verify(linkToken, UUID.fromString(fileId))
                    .map(user -> new AuthPrincipal(user, Role.DOWNLOAD_LINK));
        }
        return Optional.empty();
    }

    private void writeError(HttpServletResponse response, HttpStatus status, ApiError.Code code,
                            String message) throws IOException {
        var span = tracer.currentSpan();
        String traceId = span == null ? null : span.context().traceId();
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), new ApiError(code.name(), message, traceId));
    }
}
