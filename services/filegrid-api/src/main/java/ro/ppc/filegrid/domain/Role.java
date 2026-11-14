package ro.ppc.filegrid.domain;

import java.util.Optional;

/**
 * Roles from contracts/openapi.yaml. {@link #DOWNLOAD_LINK} is internal: the principal given
 * to a request that carries a valid short-lived download token. It is never issued in a
 * Session and can only read one file's content.
 */
public enum Role {
    FIELD("field"),
    DISPATCH("dispatch"),
    CONNECTIONS("connections"),
    ADMIN("admin"),
    METER_DEVICE("meter-device"),
    DOWNLOAD_LINK("download-link");

    private final String wire;

    Role(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static Optional<Role> fromWire(String s) {
        if (s == null) {
            return Optional.empty();
        }
        for (Role r : values()) {
            if (r.wire.equals(s)) {
                return Optional.of(r);
            }
        }
        return Optional.empty();
    }
}
