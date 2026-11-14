package ro.ppc.filegrid.resilience;

/**
 * Reading the upload body failed, which is the client's connection, not the storage. It must
 * never count against a storage's circuit: a browser closing a tab would otherwise open it.
 */
public class ClientStreamException extends RuntimeException {

    public ClientStreamException(Throwable cause) {
        super("the upload was interrupted by the client", cause);
    }
}
