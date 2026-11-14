package ro.ppc.filegrid.common;

import io.micrometer.tracing.Tracer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/** Turns every failure into the Error schema (code, message, traceId) with the right status. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final Tracer tracer;

    public GlobalExceptionHandler(Tracer tracer) {
        this.tracer = tracer;
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> onApi(ApiException e) {
        return body(e.status(), e.code(), e.getMessage());
    }

    @ExceptionHandler(IntegrityException.class)
    public ResponseEntity<ApiError> onIntegrity(IntegrityException e) {
        // The metric was already incremented where the mismatch was detected.
        log.warn("integrity failure category={} storage={}",
                e.category().slug(), e.storage().slug());
        return body(HttpStatus.UNPROCESSABLE_ENTITY, ApiError.Code.INTEGRITY_FAILED, e.getMessage());
    }

    @ExceptionHandler(ro.ppc.filegrid.policy.PolicyValidationException.class)
    public ResponseEntity<ApiError> onPolicy(ro.ppc.filegrid.policy.PolicyValidationException e) {
        return body(HttpStatus.BAD_REQUEST, ApiError.Code.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiError> onTooLarge(MaxUploadSizeExceededException e) {
        return body(HttpStatus.PAYLOAD_TOO_LARGE, ApiError.Code.TOO_LARGE, "file exceeds upload limit");
    }

    @ExceptionHandler({MethodArgumentNotValidException.class,
            MissingServletRequestParameterException.class,
            MissingRequestHeaderException.class,
            IllegalArgumentException.class})
    public ResponseEntity<ApiError> onBadRequest(Exception e) {
        return body(HttpStatus.BAD_REQUEST, ApiError.Code.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> onOther(Exception e) {
        log.error("unhandled error", e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, ApiError.Code.INTERNAL, "internal error");
    }

    private ResponseEntity<ApiError> body(HttpStatus status, ApiError.Code code, String message) {
        var span = tracer.currentSpan();
        String traceId = span == null ? null : span.context().traceId();
        return ResponseEntity.status(status).body(new ApiError(code.name(), message, traceId));
    }
}
