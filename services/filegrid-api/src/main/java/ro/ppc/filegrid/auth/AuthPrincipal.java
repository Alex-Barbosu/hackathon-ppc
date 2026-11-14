package ro.ppc.filegrid.auth;

import ro.ppc.filegrid.domain.Role;

/** Who is calling: set on the request by {@link AuthFilter}, read by controllers. */
public record AuthPrincipal(String username, Role role) {
}
