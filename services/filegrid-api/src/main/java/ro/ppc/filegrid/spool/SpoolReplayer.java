package ro.ppc.filegrid.spool;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.FileRepository;
import ro.ppc.filegrid.files.FileRow;
import ro.ppc.filegrid.files.FileService;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.resilience.StorageDownException;
import ro.ppc.filegrid.resilience.StorageGuard;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/**
 * Moves parked files to the storage the policy named, once that storage works again.
 *
 * <p>For each due item: copy the spooled bytes to the target, point the {@code files} row at it,
 * then check the copy by re-reading and hashing it the same way a download does. Only a copy that
 * checks out lets the spool file go. If the check fails the row goes back to the spool and the item
 * is retried later, so a bad copy can never replace the only good one.
 *
 * <p>Several replicas may run this; the database hands each item to one of them
 * ({@link SpoolRepository#claimDue}). Targets whose circuit is open are not attempted, so a dead
 * storage is not hammered. Bytes are copied as they are: an encrypted file stays encrypted.
 */
@Service
public class SpoolReplayer {

    private static final Logger log = LoggerFactory.getLogger(SpoolReplayer.class);
    private static final List<Storage> TARGETS = List.of(Storage.DB, Storage.S3, Storage.FTP);
    private static final int BATCH = 10;
    private static final int LEASE_SECONDS = 120;

    private final SpoolRepository items;
    private final StorageRegistry storages;
    private final StorageGuard guard;
    private final FileRepository files;
    private final FileService fileService;
    private final FileGridMetrics metrics;
    private final SpoolGauges gauges;

    public SpoolReplayer(SpoolRepository items, StorageRegistry storages, StorageGuard guard,
                         FileRepository files, FileService fileService, FileGridMetrics metrics,
                         SpoolGauges gauges) {
        this.items = items;
        this.storages = storages;
        this.guard = guard;
        this.files = files;
        this.fileService = fileService;
        this.metrics = metrics;
        this.gauges = gauges;
    }

    @Scheduled(initialDelayString = "PT10S", fixedDelayString = "PT5S")
    public void run() {
        try {
            replayDue();
        } catch (RuntimeException e) {
            // Typically the database is down; the next tick tries again.
            log.warn("spool replay skipped: {}", e.getClass().getSimpleName());
        }
        try {
            refreshGauges();
        } catch (RuntimeException e) {
            log.debug("spool gauge not refreshed: {}", e.getClass().getSimpleName());
        }
    }

    /** Replays what is due. Returns how many files were moved. Package-visible for tests. */
    public int replayDue() {
        List<Storage> usable = new ArrayList<>();
        for (Storage s : TARGETS) {
            if (guard.allows(s)) {
                usable.add(s);
            }
        }
        int moved = 0;
        for (SpoolItem item : items.claimDue(usable, BATCH, LEASE_SECONDS)) {
            if (replayOne(item)) {
                moved++;
            }
        }
        return moved;
    }

    private boolean replayOne(SpoolItem item) {
        FileRow row = files.find(item.fileId()).orElse(null);
        if (row == null) {
            // The file row is gone: nothing to deliver. Drop the leftovers.
            log.warn("spool item without a file row file_id={}", item.fileId());
            quietlyDeleteSpoolFile(item);
            items.delete(item.id());
            return false;
        }
        StorageAdapter spool = storages.get(Storage.SPOOL);
        StorageAdapter target = storages.get(item.target());
        long started = System.nanoTime();
        try {
            if (!"spool".equals(row.storage())) {
                // A previous attempt got as far as updating the row and then stopped. The bytes are
                // already at the target; finish by checking them and tidying up.
                return finish(item, row, started);
            }
            if (!(spool instanceof SpoolStorage spoolFiles) || !spoolFiles.exists(item.path())) {
                fail(item, "spool file missing");
                return false;
            }
            long size = spoolFiles.size(item.path());
            StoredRef ref;
            try (InputStream in = spool.read(item.path())) {
                if (in == null) {
                    fail(item, "spool file missing");
                    return false;
                }
                String type = row.encrypted() ? "application/octet-stream" : row.contentType();
                ref = guard.call(item.target(), () -> target.write(in, item.fileId().toString(),
                        WriteMeta.of(item.category(), type, size)));
            }
            files.relocate(item.fileId(), item.target().slug(), ref.key(), "stored");
            return finish(item, files.find(item.fileId()).orElse(row), started);
        } catch (StorageDownException e) {
            fail(item, "storage " + item.target().slug() + " unavailable");
            return false;
        } catch (Exception e) {
            fail(item, e.getClass().getSimpleName());
            return false;
        }
    }

    /** Checks the copy at the target; only a good copy releases the spool file. */
    private boolean finish(SpoolItem item, FileRow row, long started) {
        var result = fileService.verify(item.fileId(), "spool-replay");
        if (!result.ok()) {
            // Put the row back so readers use the spool copy, and try again later.
            files.relocate(item.fileId(), "spool", item.path(), "spooled");
            fail(item, "the copy at " + item.target().slug() + " did not verify");
            log.error("spool replay produced a bad copy file_id={} target={}", item.fileId(), item.target().slug());
            return false;
        }
        items.delete(item.id());
        quietlyDeleteSpoolFile(item);
        metrics.recordOp(item.category(), item.target(), FileGridMetrics.Op.WRITE, FileGridMetrics.Outcome.OK,
                Duration.ofNanos(System.nanoTime() - started));
        log.info("spool replayed file_id={} category={} target={}", item.fileId(), item.category().slug(),
                item.target().slug());
        return true;
    }

    private void fail(SpoolItem item, String why) {
        // Wait longer after each failure, up to five minutes.
        int backoff = (int) Math.min(300, 5L << Math.min(item.attempts(), 6));
        items.markFailed(item.id(), why, backoff);
        log.info("spool replay deferred file_id={} attempts={} reason={}", item.fileId(), item.attempts(), why);
    }

    private void quietlyDeleteSpoolFile(SpoolItem item) {
        try {
            storages.get(Storage.SPOOL).delete(item.path());
        } catch (Exception e) {
            log.warn("could not delete spool file file_id={}", item.fileId());
        }
    }

    private void refreshGauges() {
        Map<Category, Long> byCategory = items.pendingByCategory();
        for (Category c : Category.values()) {
            // Meter readings are parked as plain files by MeterSpool and counted by its own job.
            if (c != Category.METER) {
                gauges.set(c, byCategory.getOrDefault(c, 0L));
            }
        }
    }
}
