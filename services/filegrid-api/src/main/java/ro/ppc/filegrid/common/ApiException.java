package ro.ppc.filegrid.common;

import org.springframework.http.HttpStatus;

/** A failure that maps directly onto an HTTP status and an Error-schema {@code code}. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final ApiError.Code code;

    public ApiException(HttpStatus status, ApiError.Code code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public ApiError.Code code() {
        return code;
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, ApiError.Code.UNAUTHORIZED, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, ApiError.Code.FORBIDDEN, message);
    }

    /** 409. The Error schema has no CONFLICT code, so it carries BAD_REQUEST. */
    public static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, ApiError.Code.BAD_REQUEST, message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, ApiError.Code.NOT_FOUND, message);
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiError.Code.BAD_REQUEST, message);
    }

    public static ApiException tooLarge(String message) {
        return new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, ApiError.Code.TOO_LARGE, message);
    }

    public static ApiException storageUnavailable(String message) {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ApiError.Code.STORAGE_UNAVAILABLE, message);
    }
}
