package ro.ppc.filegrid.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Auth seam. JWT validation is the next round; for now every request passes through and is
 * attributed to the demo principal. The single place to add JWT is {@link #authenticate}:
 * parse the Bearer token, verify it against JWT_SECRET, set the principal/role, and reject
 * with 401 when required. Nothing else in the app needs to change — controllers read the
 * principal from the request attribute set here.
 */
@Component
@Order(1)
public class AuthFilter extends OncePerRequestFilter {

    public static final String PRINCIPAL_ATTR = "filegrid.principal";
    public static final String ROLE_ATTR = "filegrid.role";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        authenticate(request);
        chain.doFilter(request, response);
    }

    /** No-op today. Swap the body for Bearer-token verification to turn auth on. */
    private void authenticate(HttpServletRequest request) {
        if (request.getAttribute(PRINCIPAL_ATTR) == null) {
            request.setAttribute(PRINCIPAL_ATTR, "demo");
            request.setAttribute(ROLE_ATTR, "admin");
        }
    }
}
