package ro.ppc.filegrid.spool;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.files.FileRepository;
import ro.ppc.filegrid.files.FileRow;
import ro.ppc.filegrid.files.FileService;
import ro.ppc.filegrid.files.dto.VerifyResult;
import ro.ppc.filegrid.metrics.FileGridMetrics;
import ro.ppc.filegrid.resilience.StorageGuard;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;
import ro.ppc.filegrid.storage.StoredRef;
import ro.ppc.filegrid.storage.WriteMeta;

/** What happens to a parked file once its storage is back, and when it must not be touched. */
class SpoolReplayerTest {

    @TempDir
    Path spoolDir;

    private final UUID fileId = UUID.randomUUID();
    private final byte[] data = "parked bytes".repeat(1000).getBytes();

    private SpoolRepository items;
    private FileRepository files;
    private FileService fileService;
    private StorageGuard guard;
    private SpoolStorage spool;
    private Target s3;
    private SpoolReplayer replayer;
    private FileRow row;
    private final io.micrometer.tracing.test.simple.SimpleTracer tracer = new io.micrometer.tracing.test.simple.SimpleTracer();
    private final ro.ppc.filegrid.observability.Spans spans = new ro.ppc.filegrid.observability.Spans(tracer);

    @BeforeEach
    void setUp() throws Exception {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        guard = new StorageGuard(registry, 10, 3, 50f, 3600);
        spool = new SpoolStorage(spoolDir.toString());
        s3 = new Target(Storage.S3);
        spool.write(new ByteArrayInputStream(data), fileId.toString(),
                WriteMeta.of(Category.VIDEO, "application/octet-stream", -1));

        StorageRegistry storages = mock(StorageRegistry.class);
        when(storages.get(Storage.SPOOL)).thenReturn(spool);
        when(storages.get(Storage.S3)).thenReturn(s3);

        items = mock(SpoolRepository.class);
        files = mock(FileRepository.class);
        row = parkedRow();
        when(files.find(fileId)).thenAnswer(inv -> Optional.of(row));
        fileService = mock(FileService.class);
        when(fileService.verify(any(), anyString())).thenReturn(new VerifyResult(true, "x", "x", OffsetDateTime.now()));

        replayer = new SpoolReplayer(items, storages, guard, files, fileService, new FileGridMetrics(registry),
                new SpoolGauges(registry), spans);
    }

    private FileRow parkedRow() {
        return new FileRow(fileId, "video", "spool", "video/" + fileId, data.length, "ab".repeat(32), "video/mp4",
                null, null, null, null, "field", false, "spooled", null, OffsetDateTime.now(), null);
    }

    private SpoolItem item(int attempts) {
        return new SpoolItem(7, fileId, Category.VIDEO, Storage.S3, "video/" + fileId, attempts);
    }

    private void due(SpoolItem... due) {
        when(items.claimDue(any(), anyInt(), anyInt())).thenReturn(List.of(due));
    }

    @Test
    void aParkedFileIsCopiedToItsStorageCheckedAndOnlyThenReleased() throws Exception {
        due(item(1));

        int moved = replayer.replayDue();

        assertThat(moved).isEqualTo(1);
        assertThat(s3.objects.get(fileId.toString())).as("the bytes reached s3 unchanged").isEqualTo(data);
        verify(files).relocate(fileId, "s3", fileId.toString(), "stored");
        verify(fileService).verify(fileId, "spool-replay");
        verify(items).delete(7);
        assertThat(spool.exists("video/" + fileId)).as("the spool copy is removed only after the check").isFalse();
    }

    @Test
    void aReplayIsItsOwnTraceWithAWriteSpanToTheTargetStorage() throws Exception {
        due(item(2));

        replayer.replayDue();

        var write = tracer.getSpans().stream().filter(s -> s.getName().equals("storage.write")).toList();
        assertThat(write).hasSize(1);
        assertThat(write.get(0).getTags()).containsEntry("filegrid.storage", "s3").containsEntry("filegrid.category", "video")
                .containsEntry("filegrid.file_id", fileId.toString()).containsEntry("filegrid.purpose", "spool_replay")
                .containsEntry("filegrid.attempt", "2");
        assertThat(write.get(0).getError()).isNull();
    }

    @Test
    void aReplayThatFailsIsAFailedSpan() throws Exception {
        due(item(1));
        s3.fail = true;

        replayer.replayDue();

        assertThat(tracer.getSpans().stream().filter(s -> s.getName().equals("storage.write")).findFirst().orElseThrow().getError()).isNotNull();
    }

    @Test
    void aCopyThatFailsTheCheckPutsTheFileBackOnTheSpoolAndKeepsIt() throws Exception {
        due(item(1));
        when(fileService.verify(any(), anyString())).thenReturn(new VerifyResult(false, "a", "b", OffsetDateTime.now()));

        int moved = replayer.replayDue();

        assertThat(moved).isZero();
        verify(files).relocate(fileId, "spool", "video/" + fileId, "spooled");
        verify(items, never()).delete(anyLong());
        verify(items).markFailed(eq(7L), anyString(), anyInt());
        assertThat(spool.exists("video/" + fileId)).as("the only good copy is kept").isTrue();
    }

    @Test
    void aStorageThatIsStillDownKeepsTheFileAndBacksOff() throws Exception {
        due(item(1));
        s3.fail = true;

        int moved = replayer.replayDue();

        assertThat(moved).isZero();
        verify(files, never()).relocate(any(), anyString(), anyString(), anyString());
        verify(items).markFailed(eq(7L), anyString(), anyInt());
        verify(items, never()).delete(anyLong());
        assertThat(spool.exists("video/" + fileId)).isTrue();
    }

    @Test
    void theWaitBetweenTriesGrowsAndStopsAtFiveMinutes() throws Exception {
        s3.fail = true;
        ArgumentCaptor<Integer> wait = ArgumentCaptor.forClass(Integer.class);

        for (int attempts : new int[] {1, 3, 6, 20}) {
            due(item(attempts));
            replayer.replayDue();
        }

        verify(items, org.mockito.Mockito.times(4)).markFailed(eq(7L), anyString(), wait.capture());
        assertThat(wait.getAllValues()).containsExactly(10, 40, 300, 300);
    }

    @Test
    void storagesWhoseCircuitIsOpenAreNotAttempted() throws Exception {
        for (int i = 0; i < 3; i++) {
            try {
                guard.call(Storage.S3, () -> {
                    throw new IOException("down");
                });
            } catch (RuntimeException expected) {
                // opens the circuit
            }
        }
        when(items.claimDue(any(), anyInt(), anyInt())).thenReturn(List.of());

        replayer.replayDue();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<java.util.Collection<Storage>> allowed = ArgumentCaptor.forClass(java.util.Collection.class);
        verify(items).claimDue(allowed.capture(), anyInt(), anyInt());
        assertThat(allowed.getValue()).containsExactlyInAnyOrder(Storage.DB, Storage.FTP);
        assertThat(s3.writeAttempts).isZero();
    }

    @Test
    void aMissingSpoolFileIsReportedNotSilentlyDropped() throws Exception {
        spool.delete("video/" + fileId);
        due(item(1));

        int moved = replayer.replayDue();

        assertThat(moved).isZero();
        verify(items).markFailed(eq(7L), eq("spool file missing"), anyInt());
        verify(items, never()).delete(anyLong());
    }

    @Test
    void anAttemptThatGotAsFarAsMovingTheRowIsFinishedWithoutCopyingAgain() throws Exception {
        // A crash after the row was pointed at s3 but before the spool copy was removed.
        row = new FileRow(fileId, "video", "s3", fileId.toString(), data.length, "ab".repeat(32), "video/mp4",
                null, null, null, null, "field", false, "stored", null, OffsetDateTime.now(), null);
        due(item(2));

        int moved = replayer.replayDue();

        assertThat(moved).isEqualTo(1);
        assertThat(s3.writeAttempts).as("nothing is copied twice").isZero();
        verify(fileService).verify(fileId, "spool-replay");
        verify(items).delete(7);
        assertThat(spool.exists("video/" + fileId)).isFalse();
    }

    @Test
    void anItemWhoseFileRowIsGoneIsDropped() throws Exception {
        when(files.find(fileId)).thenReturn(Optional.empty());
        due(item(1));

        replayer.replayDue();

        verify(items).delete(7);
        assertThat(spool.exists("video/" + fileId)).isFalse();
        assertThat(s3.writeAttempts).isZero();
    }

    @Test
    void nothingDueDoesNothing() throws Exception {
        when(items.claimDue(any(), anyInt(), anyInt())).thenReturn(List.of());

        assertThat(replayer.replayDue()).isZero();
    }

    /** The real storage, here a stand-in that can be told to be down. */
    private static final class Target implements StorageAdapter {
        final Map<String, byte[]> objects = new HashMap<>();
        int writeAttempts;
        boolean fail;
        private final Storage kind;

        Target(Storage kind) {
            this.kind = kind;
        }

        @Override
        public Storage kind() {
            return kind;
        }

        @Override
        public StoredRef write(InputStream body, String key, WriteMeta meta) throws Exception {
            writeAttempts++;
            if (fail) {
                throw new IOException("connection refused");
            }
            byte[] all = body.readAllBytes();
            objects.put(key, all);
            return new StoredRef(kind, key, all.length);
        }

        @Override
        public InputStream read(String key) {
            return null;
        }

        @Override
        public void delete(String key) {
            objects.remove(key);
        }

        @Override
        public boolean health() {
            return !fail;
        }
    }
}
