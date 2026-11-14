package ro.ppc.filegrid.auth;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import ro.ppc.filegrid.domain.Role;

/**
 * Which routes each kind of caller may reach. Kept as pure functions so every rule has a
 * unit test and the filter stays a thin shell.
 *
 * <ul>
 *   <li>meter-device (the static device token): only {@code POST /meter-readings}.
 *   <li>download-link (60 s token): only {@code GET /files/{id}/content}; the id match is
 *       checked when the token is verified.
 *   <li>field, dispatch, connections: everything except {@code /meter-readings}, which the
 *       contract reserves for devices.
 *   <li>admin: everything.
 * </ul>
 *
 * <p>Per-category rules (for example documents only for connections) are not enforced yet.
 */
public final class AccessRules {

    public static final String METER_PATH = "/api/v1/meter-readings";
    public static final String LOGIN_PATH = "/api/v1/auth/login";
    public static final String HEALTH_PATH = "/api/v1/health";

    private static final Pattern CONTENT_PATH =
            Pattern.compile("^/api/v1/files/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/content$");

    private AccessRules() {
    }

    /** Routes that need no credentials. Exact matches, so nothing is public by prefix accident. */
    public static boolean isPublic(String path) {
        return HEALTH_PATH.equals(path) || LOGIN_PATH.equals(path) || path.startsWith("/actuator/");
    }

    /** If {@code path} is a file content download, returns the file id text; else null. */
    public static String contentFileId(String path) {
        Matcher m = CONTENT_PATH.matcher(path);
        return m.matches() ? m.group(1) : null;
    }

    public static boolean allowed(Role role, String method, String path) {
        return switch (role) {
            case ADMIN -> true;
            case METER_DEVICE -> "POST".equals(method) && METER_PATH.equals(path);
            case DOWNLOAD_LINK -> "GET".equals(method) && contentFileId(path) != null;
            case FIELD, DISPATCH, CONNECTIONS -> !METER_PATH.equals(path);
        };
    }
}
