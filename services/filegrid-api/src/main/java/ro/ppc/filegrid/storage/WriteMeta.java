package ro.ppc.filegrid.storage;

import ro.ppc.filegrid.domain.Category;

/**
 * Side-channel facts a backend may need while writing. {@code sizeHint} is -1 when unknown
 * (e.g. streamed multipart uploads). No file name or content here: those never reach a
 * backend as metadata, so they cannot leak into storage-side logs.
 */
public record WriteMeta(Category category, String contentType, long sizeHint) {

    public static WriteMeta of(Category category, String contentType, long sizeHint) {
        return new WriteMeta(category, contentType, sizeHint);
    }
}
