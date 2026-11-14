package ro.ppc.filegrid.files;

import jakarta.servlet.http.HttpServletResponse;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Region;
import ro.ppc.filegrid.domain.Storage;
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

    public FileController(FileService fileService, FileRepository fileRepository, ReceiptSigner signer) {
        this.fileService = fileService;
        this.fileRepository = fileRepository;
        this.signer = signer;
    }

    /** POST /files — multipart upload of a small file (outage, document). 201 FileReceipt. */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<FileReceipt> upload(
            @RequestParam("category") String category,
            @RequestParam(value = "region", required = false) String region,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-FileGrid-Force-Storage", required = false) String forceStorage)
            throws Exception {

        Category cat = parseCategory(category);
        String reg = parseRegion(region);
        Storage force = forceStorage == null ? null : parseStorage(forceStorage);
        String contentType = file.getContentType() != null
                ? file.getContentType() : MediaType.APPLICATION_OCTET_STREAM_VALUE;

        var req = new FileService.UploadRequest(cat, reg, description,
                file.getOriginalFilename(), contentType, file.getSize(), currentUser(), force);

        try (InputStream body = file.getInputStream()) {
            FileReceipt receipt = fileService.store(req, body);
            return ResponseEntity.status(HttpStatus.CREATED).body(receipt);
        }
    }

    /** GET /files — paged search. */
    @GetMapping
    public SearchPage search(
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "region", required = false) String region,
            @RequestParam(value = "from", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(value = "to", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size) {

        String cat = category == null ? null : parseCategory(category).slug();
        String reg = region == null ? null : parseRegion(region);
        if (size < 1 || size > 100) {
            throw ApiException.badRequest("size must be 1..100");
        }
        if (page < 0) {
            throw ApiException.badRequest("page must be >= 0");
        }

        var result = fileRepository.search(cat, q, reg, from, to, page, size);
        List<FileMeta> items = result.items().stream()
                .map(r -> FileMapper.toMeta(r, signer)).toList();
        return new SearchPage(items, page, size, result.total());
    }

    /** GET /files/{id} — metadata + receipt. */
    @GetMapping("/{id}")
    public FileMeta metadata(@PathVariable UUID id) {
        return FileMapper.toMeta(fileService.metadata(id), signer);
    }

    /** GET /files/{id}/content — stream bytes, verifying SHA-256; 422 on mismatch. */
    @GetMapping("/{id}/content")
    public void download(@PathVariable UUID id, HttpServletResponse response) throws Exception {
        FileService.DownloadStream dl = fileService.openForDownload(id);
        response.setStatus(HttpStatus.OK.value());
        response.setContentType(dl.contentType() != null
                ? dl.contentType() : MediaType.APPLICATION_OCTET_STREAM_VALUE);
        response.setHeader("X-Content-SHA256", dl.sha256());
        if (dl.sizeBytes() >= 0) {
            response.setContentLengthLong(dl.sizeBytes());
        }
        try (InputStream in = dl.stream(); OutputStream out = response.getOutputStream()) {
            in.transferTo(out);
        }
    }

    /** POST /files/{id}/verify — re-hash the stored object and compare. */
    @PostMapping("/{id}/verify")
    public VerifyResult verify(@PathVariable UUID id) {
        return fileService.verify(id);
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
            return Storage.fromSlug(s);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("unknown storage: " + s);
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

    /** Auth arrives in the next round; until then uploads are attributed to the demo user. */
    private static String currentUser() {
        return "demo";
    }
}
