package ro.ppc.filegrid.files;

import jakarta.servlet.http.HttpServletResponse;
import java.io.InputStream;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import ro.ppc.filegrid.auth.AuthFilter;
import ro.ppc.filegrid.auth.AuthPrincipal;
import ro.ppc.filegrid.auth.DownloadTokenService;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.County;
import ro.ppc.filegrid.domain.Region;
import ro.ppc.filegrid.domain.Role;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.DownloadLink;
import ro.ppc.filegrid.files.dto.FileMeta;
import ro.ppc.filegrid.files.dto.FileReceipt;
import ro.ppc.filegrid.files.dto.SearchPage;
import ro.ppc.filegrid.files.dto.VerifyResult;

/** The /api/v1/files surface, mapped exactly onto contracts/openapi.yaml. */
@RestController
@RequestMapping("/api/v1/files")
public class FileController {

    private final FileService fileService;
    private final FileRepository fileRepository;
    private final ReceiptSigner signer;
    private final DownloadTokenService downloadTokens;

    public FileController(FileService fileService, FileRepository fileRepository, ReceiptSigner signer,
                          DownloadTokenService downloadTokens) {
        this.fileService = fileService;
        this.fileRepository = fileRepository;
        this.signer = signer;
        this.downloadTokens = downloadTokens;
    }

    /** POST /files — multipart upload of a small file (outage, document). 201 FileReceipt. */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<FileReceipt> upload(
            @RequestParam("category") String category,
            @RequestParam(value = "region", required = false) String region,
            @RequestParam(value = "county", required = false) String county,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-FileGrid-Force-Storage", required = false) String forceStorage,
            @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller)
            throws Exception {

        // Contract: the header bypasses the policy, so only an admin may send it.
        if (forceStorage != null && caller.role() != Role.ADMIN) {
            throw ApiException.forbidden("X-FileGrid-Force-Storage is admin only");
        }
        Category cat = parseCategory(category);
        County.Place place = parsePlace(region, county);
        Storage force = forceStorage == null ? null : parseStorage(forceStorage);
        String contentType = file.getContentType() != null
                ? file.getContentType() : MediaType.APPLICATION_OCTET_STREAM_VALUE;

        var req = new FileService.UploadRequest(cat, place.region(), place.county(), description,
                file.getOriginalFilename(), contentType, file.getSize(), caller.username(), force);

        // The service may need the bytes again if the primary storage fails halfway (the fallback
        // starts from the beginning), so it asks for a fresh stream each time instead of being handed one.
        FileService.Stored stored = fileService.put(req, file::getInputStream);
        // The same bytes as a file already stored (same category and region): its receipt, and a header to say so.
        // The status stays 201, the only success in the contract, so no client has to learn a new one.
        var response = ResponseEntity.status(HttpStatus.CREATED);
        if (stored.duplicate()) {
            response.header("X-FileGrid-Deduplicated", "true");
        }
        return response.body(stored.receipt());
    }

    /** GET /files — paged search. */
    @GetMapping
    public SearchPage search(
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "region", required = false) String region,
            @RequestParam(value = "county", required = false) String county,
            @RequestParam(value = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(value = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size) {

        String cat = category == null ? null : parseCategory(category).slug();
        String reg = region == null ? null : parseRegion(region);
        String cty = county == null ? null : parsePlace(null, county).county();
        if (size < 1 || size > 100) {
            throw ApiException.badRequest("size must be 1..100");
        }
        if (page < 0) {
            throw ApiException.badRequest("page must be >= 0");
        }

        var result = fileRepository.search(cat, q, reg, cty, from, to, page, size);
        List<FileMeta> items = result.items().stream()
                .map(r -> FileMapper.toMeta(r, signer)).toList();
        return new SearchPage(items, page, size, result.total());
    }

    /** GET /files/{id} — metadata + receipt. */
    @GetMapping("/{id}")
    public FileMeta metadata(@PathVariable UUID id,
                             @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) {
        return FileMapper.toMeta(fileService.readMetadata(id, caller.username()), signer);
    }

    /** GET /files/{id}/content — stream bytes, verifying SHA-256; 422 on mismatch. */
    @GetMapping("/{id}/content")
    public void download(@PathVariable UUID id, HttpServletResponse response,
                         @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) throws Exception {
        // With a download link the caller is the user the link was minted for.
        FileService.DownloadStream dl = fileService.openForDownload(id, caller.username());
        response.setStatus(HttpStatus.OK.value());
        response.setContentType(dl.contentType() != null
                ? dl.contentType() : MediaType.APPLICATION_OCTET_STREAM_VALUE);
        response.setHeader("X-Content-SHA256", dl.sha256());
        if (dl.sizeBytes() >= 0) {
            response.setContentLengthLong(dl.sizeBytes());
        }
        try (InputStream in = dl.stream()) {
            in.transferTo(response.getOutputStream());
        } catch (VerifyingInputStream.StreamIntegrityException e) {
            // A large file read in one pass failed its check at the end. The service has counted, audited and logged it.
            // The last chunk was held back, so the body is shorter than Content-Length: the client sees a cut transfer.
            // Do not write an error body here: it would be taken for file bytes.
            response.flushBuffer();
        }
    }

    /** DELETE /files/{id} (admin; AccessRules refuses the others): the bytes first, then the row, with an audit event. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id,
                                       @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) {
        fileService.delete(id, caller.username());
        return ResponseEntity.noContent().build();
    }

    /** POST /files/{id}/verify — re-hash the stored object and compare. */
    @PostMapping("/{id}/verify")
    public VerifyResult verify(@PathVariable UUID id,
                               @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) {
        return fileService.verify(id, caller.username());
    }

    /**
     * POST /files/{id}/download-link: mint a 60 s token so the browser can stream the file to
     * disk with a plain link instead of buffering it behind a bearer header. Callable only
     * with a session (a download token itself is refused here by AccessRules).
     */
    @PostMapping("/{id}/download-link")
    public DownloadLink downloadLink(@PathVariable UUID id,
                                     @RequestAttribute(AuthFilter.PRINCIPAL_ATTR) AuthPrincipal caller) {
        FileRow row = fileService.mintLinkFor(id, caller.username()); // 404 for an unknown id
        var link = downloadTokens.mint(id, caller.username());
        return new DownloadLink("/api/v1/files/" + id + "/content?token=" + link.token(),
                link.expiresAt(), row.sha256());
    }

    // --- parsing helpers: a bad enum is a 400, not a 500 ---

    private static Category parseCategory(String s) {
        try {
            return Category.fromSlug(s);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("unknown category: " + s);
        }
    }

    private static Storage parseStorage(String s) {
        try {
            Storage storage = Storage.fromSlug(s);
            if (storage == Storage.SPOOL) {
                // The contract allows db, s3 and ftp. The spool is only ever a fallback.
                throw new IllegalArgumentException("spool cannot be forced");
            }
            return storage;
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("unknown storage: " + s);
        }
    }

    /** Region and county checked together (400 for an unknown county or one outside the region). */
    private static County.Place parsePlace(String region, String county) {
        parseRegion(region);
        try {
            return County.resolve(region, county);
        } catch (IllegalArgumentException e) {
            // The message names only the county and region, both from fixed lists: nothing personal is echoed.
            throw ApiException.badRequest(e.getMessage().startsWith("county ") ? e.getMessage() : "unknown county");
        }
    }

    private static String parseRegion(String s) {
        if (s == null) {
            return null;
        }
        try {
            return Region.fromSlug(s).slug();
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("unknown region: " + s);
        }
    }
}
