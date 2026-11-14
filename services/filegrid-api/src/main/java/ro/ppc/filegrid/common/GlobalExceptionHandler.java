package ro.ppc.filegrid.common;

import io.micrometer.tracing.Tracer;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import ro.ppc.filegrid.policy.PolicyValidationException;

/**
 * Turns every failure into the Error schema (code, message, traceId).
 *
 * <p>Extending {@link ResponseEntityExceptionHandler} gives each standard Spring MVC error its
 * correct status: an unknown route is 404, a wrong method 405, a bad body 400. Without it
 * those fell into the catch-all below and came back as 500. All of them are rendered through
 * {@link #handleExceptionInternal} so the body is always our Error schema.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

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

    @ExceptionHandler(PolicyValidationException.class)
    public ResponseEntity<ApiError> onPolicy(PolicyValidationException e) {
        return body(HttpStatus.BAD_REQUEST, ApiError.Code.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> onIllegalArgument(IllegalArgumentException e) {
        return body(HttpStatus.BAD_REQUEST, ApiError.Code.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> onOther(Exception e) {
        log.error("unhandled error", e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, ApiError.Code.INTERNAL, "internal error");
    }

    /** Field names only: the rejected values may be personal data and must not be echoed. */
    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        String fields = ex.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getField).distinct().sorted().collect(Collectors.joining(", "));
        return render(HttpStatus.BAD_REQUEST, headers, "invalid field(s): " + fields);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object ignored,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        // ErrorResponse details are Spring's own client-safe text ("Required parameter ... is
        // not present"); anything else gets a generic message rather than the exception text.
        String message = ex instanceof ErrorResponse er && er.getBody().getDetail() != null
                ? er.getBody().getDetail()
                : HttpStatus.valueOf(status.value()).getReasonPhrase().toLowerCase();
        return render(status, headers, message);
    }

    private ResponseEntity<Object> render(HttpStatusCode status, HttpHeaders headers, String message) {
        ApiError.Code code = switch (status.value()) {
            case 401 -> ApiError.Code.UNAUTHORIZED;
            case 403 -> ApiError.Code.FORBIDDEN;
            case 404 -> ApiError.Code.NOT_FOUND;
            case 413 -> ApiError.Code.TOO_LARGE;
            default -> status.is4xxClientError() ? ApiError.Code.BAD_REQUEST : ApiError.Code.INTERNAL;
        };
        return ResponseEntity.status(status).headers(headers)
                .body(new ApiError(code.name(), message, traceId()));
    }

    private ResponseEntity<ApiError> body(HttpStatus status, ApiError.Code code, String message) {
        return ResponseEntity.status(status).body(new ApiError(code.name(), message, traceId()));
    }

    private String traceId() {
        var span = tracer.currentSpan();
        return span == null ? null : span.context().traceId();
    }
}
