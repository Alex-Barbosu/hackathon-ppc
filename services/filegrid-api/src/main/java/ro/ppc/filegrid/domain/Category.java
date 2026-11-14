package ro.ppc.filegrid.domain;

/** The four file kinds FileGrid routes. Enum name is the wire slug (lower-cased). */
public enum Category {
    METER, OUTAGE, DOCUMENT, VIDEO;

    public String slug() {
        return name().toLowerCase();
    }

    public static Category fromSlug(String s) {
        if (s == null) {
            throw new IllegalArgumentException("category is required");
        }
        return Category.valueOf(s.trim().toUpperCase());
    }
}
