package ro.ppc.filegrid.tus;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import ro.ppc.filegrid.auth.AuthFilter;
import ro.ppc.filegrid.auth.AuthPrincipal;
import ro.ppc.filegrid.common.ApiError;
import ro.ppc.filegrid.common.ApiException;

/**
 * tus 1.0.0 resumable upload (core protocol + the creation extension), at the paths in
 * contracts/openapi.yaml: POST /files/tus, HEAD and PATCH /files/tus/{id}. It is hand-written
 * rather than built on a tus library because every byte has to go to S3 multipart as it
 * arrives, and the state has to be shared by all replicas; both are the point of this class.
 * Authentication is the same bearer token as the rest of the API (see AuthFilter).
 */
@RestController
@RequestMapping("/api/v1/files/tus")
public class TusController {

    static final String TUS_VERSION = "1.0.0";
    private static final String OFFSET_STREAM = "application/offset+octet-stream";

    private final TusService tus;

    public TusController(TusService tus) {
        this.tus = tus;
    }

    @RequestMapping(method = RequestMethod.OPTIONS)
    public ResponseEntity<Void> options() {
        return ResponseEntity.noContent()
                .header("Tus-Resumable", TUS_VERSION)
                .header("Tus-Version", TUS_VERSION)
                .header("Tus-Extension", "creation")
                .build();
    }

    /** Creation: needs Upload-Length and Upload-Metadata with at least a category. */
    @PostMapping
    public ResponseEntity<Void> create(HttpServletRequest req,
                                       @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) {
        requireTusVersion(req);
        if (req.getHeader("Upload-Defer-Length") != null) {
            throw ApiException.badRequest("Upload-Defer-Length is not supported, send Upload-Length");
        }
        long length = parseLong(req.getHeader("Upload-Length"), "Upload-Length");
        UUID id = tus.create(length, TusMetadata.parse(req.getHeader("Upload-Metadata")), caller.username());
        return ResponseEntity.status(HttpStatus.CREATED)
                .header("Tus-Resumable", TUS_VERSION)
                .header("Location", "/api/v1/files/tus/" + id)
                .build();
    }

    /** Where to resume from. */
    @RequestMapping(value = "/{id}", method = RequestMethod.HEAD)
    public ResponseEntity<Void> head(@PathVariable UUID id, HttpServletRequest req) {
        requireTusVersion(req);
        TusUpload up = tus.head(id);
        return ResponseEntity.ok()
                .header("Tus-Resumable", TUS_VERSION)
                .header("Cache-Control", "no-store")
                .header("Upload-Offset", Long.toString(up.completed() ? up.length() : up.offset()))
                .header("Upload-Length", Long.toString(up.length()))
                .build();
    }

    /** One chunk. The body is read straight from the socket into S3 parts, never into a file. */
    @PatchMapping("/{id}")
    public ResponseEntity<Void> patch(@PathVariable UUID id, HttpServletRequest req) throws IOException {
        requireTusVersion(req);
        String type = req.getContentType();
        if (type == null || !type.toLowerCase().startsWith(OFFSET_STREAM)) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ApiError.Code.BAD_REQUEST,
                    "Content-Type must be " + OFFSET_STREAM);
        }
        long offset = parseLong(req.getHeader("Upload-Offset"), "Upload-Offset");

        TusService.PatchResult result = tus.append(id, offset, req.getContentLengthLong(), req.getInputStream());

        var response = ResponseEntity.noContent()
                .header("Tus-Resumable", TUS_VERSION)
                .header("Upload-Offset", Long.toString(result.offset()));
        if (result.fileId() != null) {
            // The web client reads this on the last chunk to fetch the receipt.
            response.header("X-FileGrid-File-Id", result.fileId().toString());
        }
        return response.build();
    }

    private static void requireTusVersion(HttpServletRequest req) {
        if (!TUS_VERSION.equals(req.getHeader("Tus-Resumable"))) {
            throw new ApiException(HttpStatus.PRECONDITION_FAILED, ApiError.Code.BAD_REQUEST,
                    "Tus-Resumable must be " + TUS_VERSION);
        }
    }

    private static long parseLong(String value, String header) {
        if (value == null) {
            throw ApiException.badRequest(header + " is required");
        }
        try {
            long n = Long.parseLong(value.trim());
            if (n < 0) {
                throw new NumberFormatException();
            }
            return n;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest(header + " must be a non-negative integer");
        }
    }
}
