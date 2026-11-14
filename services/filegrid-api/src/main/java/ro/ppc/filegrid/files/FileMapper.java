package ro.ppc.filegrid.files;

import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.dto.FileMeta;

/** Row -> FileMeta, re-deriving the receipt signature so GET /files/{id} returns it too. */
final class FileMapper {

    private FileMapper() {
    }

    static FileMeta toMeta(FileRow r, ReceiptSigner signer) {
        String signature = signer.sign(r.id().toString(), r.category(), r.storage(),
                r.sizeBytes(), r.sha256());
        return new FileMeta(
                r.id().toString(),
                r.category(),
                r.storage(),
                r.sizeBytes(),
                r.sha256(),
                r.createdAt(),
                r.encrypted(),
                r.traceId(),
                signature,
                r.originalName(),
                r.contentType(),
                r.region(),
                r.description(),
                r.uploadedBy(),
                r.lastVerifiedAt(),
                r.status());
    }

    // Kept so callers see the enum round-trips; validation happens here.
    static void assertKnown(FileRow r) {
        Category.fromSlug(r.category());
        Storage.fromSlug(r.storage());
    }
}
