package ro.ppc.filegrid.common;

/** Error schema from contracts/openapi.yaml: { code, message, traceId }. */
public record ApiError(String code, String message, String traceId) {

    public enum Code {
        BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, TOO_LARGE,
        INTEGRITY_FAILED, STORAGE_UNAVAILABLE, INTERNAL
    }
}
