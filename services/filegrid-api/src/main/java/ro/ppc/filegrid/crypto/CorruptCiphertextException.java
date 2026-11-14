package ro.ppc.filegrid.crypto;

import java.io.IOException;

/**
 * The stored bytes failed authentication: a segment was changed, cut, added, reordered, or
 * belongs to another file. Callers treat it exactly like a SHA-256 mismatch.
 */
public class CorruptCiphertextException extends IOException {

    public CorruptCiphertextException(String message) {
        super(message);
    }
}
