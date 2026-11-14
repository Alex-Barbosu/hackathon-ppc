package ro.ppc.filegrid.domain;

import java.text.Normalizer;
import java.util.Locale;

/**
 * The counties the three regions serve (contracts/openapi.yaml County enum), each in exactly one region.
 * Same list as the meter simulator, so an outage and the meters around it land in the same county.
 */
public enum County {
    BUCURESTI("București", Region.MUNTENIA),
    ILFOV("Ilfov", Region.MUNTENIA),
    GIURGIU("Giurgiu", Region.MUNTENIA),
    TIMIS("Timiș", Region.BANAT),
    ARAD("Arad", Region.BANAT),
    HUNEDOARA("Hunedoara", Region.BANAT),
    CARAS_SEVERIN("Caraș-Severin", Region.BANAT),
    CONSTANTA("Constanța", Region.DOBROGEA),
    TULCEA("Tulcea", Region.DOBROGEA),
    CALARASI("Călărași", Region.DOBROGEA),
    IALOMITA("Ialomița", Region.DOBROGEA);

    private final String displayName;
    private final Region region;

    County(String displayName, Region region) {
        this.displayName = displayName;
        this.region = region;
    }

    /** The contract value, with diacritics: what is stored in {@code files.county}. */
    public String displayName() {
        return displayName;
    }

    public Region region() {
        return region;
    }

    /**
     * Accepts the contract value, and also the same name without diacritics or with the old cedilla letters
     * (ş, ţ): scripts and older keyboards send "Timis" or "Constanţa", and refusing those helps nobody.
     */
    public static County fromName(String s) {
        String wanted = fold(s);
        for (County c : values()) {
            if (fold(c.displayName).equals(wanted)) {
                return c;
            }
        }
        throw new IllegalArgumentException("unknown county");
    }

    private static String fold(String s) {
        String n = Normalizer.normalize(s.trim(), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return n.toLowerCase(Locale.ROOT).replace(' ', '-');
    }

    /** A region and county pair that has been checked against each other. */
    public record Place(String region, String county) {
    }

    /**
     * Checks an upload's region and county together: an unknown county, or a county outside the given region,
     * is an {@link IllegalArgumentException}; a missing region is taken from the county. Either may be null.
     */
    public static Place resolve(String regionSlug, String countyName) {
        Region region = regionSlug == null || regionSlug.isBlank() ? null : Region.fromSlug(regionSlug);
        if (countyName == null || countyName.isBlank()) {
            return new Place(region == null ? null : region.slug(), null);
        }
        County county = fromName(countyName);
        if (region != null && region != county.region) {
            throw new IllegalArgumentException("county " + county.displayName + " is not in region " + region.slug());
        }
        return new Place(county.region.slug(), county.displayName);
    }
}
