package ro.ppc.filegrid.domain;

/**
 * A storage backend. {@code SPOOL} is a durable local fallback location, never a primary
 * (enforced by the policy schema), so it is listed here only as a location value.
 */
public enum Storage {
    DB, S3, FTP, SPOOL;

    public String slug() {
        return name().toLowerCase();
    }

    public static Storage fromSlug(String s) {
        return Storage.valueOf(s.trim().toUpperCase());
    }
}
