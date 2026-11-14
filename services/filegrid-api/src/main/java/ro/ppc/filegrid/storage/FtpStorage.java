package ro.ppc.filegrid.storage;

import java.io.IOException;
import java.io.InputStream;
import org.apache.commons.net.ftp.FTP;
import org.apache.commons.net.ftp.FTPReply;
import org.apache.commons.net.ftp.FTPSClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import ro.ppc.filegrid.domain.Storage;

/**
 * FTPS with explicit TLS, passive mode. FTP has no atomic write, so we stream to
 * {@code key}.part, verify the size, then rename to {@code key} — a reader never sees a
 * half-written file. A fresh connection per call keeps it simple and avoids pinning a
 * virtual thread on a shared, stateful client.
 */
@Component
public class FtpStorage implements StorageAdapter {

    private static final Logger log = LoggerFactory.getLogger(FtpStorage.class);

    private final String host;
    private final int port;
    private final String user;
    private final String password;

    public FtpStorage(
            @Value("${FTP_HOST:ftp}") String host,
            @Value("${FTP_PORT:21}") int port,
            @Value("${FTP_USER:filegrid}") String user,
            @Value("${FTP_PASSWORD:}") String password) {
        this.host = host;
        this.port = port;
        this.user = user;
        this.password = password;
    }

    @Override
    public Storage kind() {
        return Storage.FTP;
    }

    @Override
    public StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception {
        String part = key + ".part";
        FTPSClient ftp = connect();
        try {
            CountingInputStream counting = new CountingInputStream(body);
            if (!ftp.storeFile(part, counting)) {
                throw new IOException("FTP storeFile failed: " + ftp.getReplyString());
            }
            long written = counting.count();

            // Verify the server reports the same size before we publish it under the real key.
            long onServer = sizeOf(ftp, part);
            if (onServer >= 0 && onServer != written) {
                ftp.deleteFile(part);
                throw new IOException("FTP size mismatch: wrote " + written + " server has " + onServer);
            }

            ftp.deleteFile(key); // rename fails if the target exists; overwrite semantics
            if (!ftp.rename(part, key)) {
                throw new IOException("FTP rename failed: " + ftp.getReplyString());
            }
            return new StoredRef(Storage.FTP, key, written);
        } catch (Exception e) {
            safeDelete(ftp, part);
            throw e;
        } finally {
            disconnect(ftp);
        }
    }

    @Override
    public InputStream read(String key) throws Exception {
        FTPSClient ftp = connect();
        InputStream raw = ftp.retrieveFileStream(key);
        if (raw == null) {
            disconnect(ftp);
            return null;
        }
        // The control connection must stay open until the data stream is drained and
        // completePendingCommand() is called; wrap so closing the stream tears both down.
        return new FtpInputStream(raw, ftp);
    }

    @Override
    public void delete(String key) throws Exception {
        FTPSClient ftp = connect();
        try {
            ftp.deleteFile(key);
        } finally {
            disconnect(ftp);
        }
    }

    @Override
    public boolean health() {
        try {
            FTPSClient ftp = connect();
            disconnect(ftp);
            return true;
        } catch (Exception e) {
            log.debug("ftp health probe failed: {}", e.toString());
            return false;
        }
    }

    private FTPSClient connect() throws IOException {
        FTPSClient ftp = new FTPSClient(); // explicit TLS by default
        // A dead or unreachable server must fail in seconds, not hang a request: the circuit
        // breaker and the fallback depend on getting an answer.
        ftp.setConnectTimeout(3000);
        ftp.setDefaultTimeout(60_000);
        ftp.setDataTimeout(java.time.Duration.ofSeconds(60));
        ftp.connect(host, port);
        ftp.setSoTimeout(60_000);
        int reply = ftp.getReplyCode();
        if (!FTPReply.isPositiveCompletion(reply)) {
            ftp.disconnect();
            throw new IOException("FTP connect refused: " + reply);
        }
        if (!ftp.login(user, password)) {
            ftp.disconnect();
            throw new IOException("FTP login failed");
        }
        ftp.execPBSZ(0);           // protect the data channel
        ftp.execPROT("P");
        ftp.enterLocalPassiveMode();
        ftp.setFileType(FTP.BINARY_FILE_TYPE);
        return ftp;
    }

    private static long sizeOf(FTPSClient ftp, String path) throws IOException {
        var f = ftp.mlistFile(path);
        return f != null ? f.getSize() : -1;
    }

    private static void safeDelete(FTPSClient ftp, String path) {
        try {
            ftp.deleteFile(path);
        } catch (Exception ignored) {
            // part file left behind only on a hard failure; the spooler/cleanup handles it
        }
    }

    private static void disconnect(FTPSClient ftp) {
        try {
            if (ftp.isConnected()) {
                ftp.logout();
                ftp.disconnect();
            }
        } catch (Exception ignored) {
            // best effort
        }
    }

    /** Ties the FTP data stream's lifecycle to the control connection cleanup. */
    private static final class FtpInputStream extends InputStream {
        private final InputStream delegate;
        private final FTPSClient ftp;

        FtpInputStream(InputStream delegate, FTPSClient ftp) {
            this.delegate = delegate;
            this.ftp = ftp;
        }

        @Override
        public int read() throws IOException {
            return delegate.read();
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            return delegate.read(b, off, len);
        }

        @Override
        public void close() throws IOException {
            try {
                delegate.close();
                ftp.completePendingCommand();
            } finally {
                disconnect(ftp);
            }
        }
    }
}
