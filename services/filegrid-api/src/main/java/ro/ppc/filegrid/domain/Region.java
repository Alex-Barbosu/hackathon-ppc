package ro.ppc.filegrid.domain;

/** The three operating regions (contracts/openapi.yaml Region enum). */
public enum Region {
    MUNTENIA, BANAT, DOBROGEA;

    public String slug() {
        return name().toLowerCase();
    }

    public static Region fromSlug(String s) {
        return Region.valueOf(s.trim().toUpperCase());
    }
}
