package ro.ppc.filegrid.meters;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.resilience.StorageGuard;

/**
 * The meter guarantee: a reading is either committed or durably parked before the meter hears
 * "accepted", and a retry never produces a second copy, whether the database is up or not.
 */
class MeterServiceTest {

    private static final String KEY = "RO-MT-1:2026-11-14T10:00:00Z:1";

    @TempDir
    Path spoolDir;

    private MeterRepository repo;
    private StorageGuard guard;
    private MeterSpool spool;
    private MeterService service;

    @BeforeEach
    void setUp() {
        repo = mock(MeterRepository.class);
        guard = new StorageGuard(new SimpleMeterRegistry(), 10, 3, 50f, 3600);
        spool = new MeterSpool(spoolDir.toString(), MeterSpoolTest.mapper());
        TransactionTemplate tx = new TransactionTemplate() {
            @Override
            public <T> T execute(TransactionCallback<T> action) {
                return action.doInTransaction(null);
            }
        };
        service = new MeterService(repo, MeterSpoolTest.mapper(), guard, tx, spool);
    }

    private MeterService.Ingested ingest(String key, int seq) {
        return service.ingest(key, MeterSpoolTest.reading("RO-MT-1", seq), "trace");
    }

    private void databaseDown() {
        when(repo.insertIfNew(anyString(), any(), anyString(), any()))
                .thenThrow(new CannotGetJdbcConnectionException("connection refused"));
    }

    @Test
    void withTheDatabaseUpTheFirstSendIsAcceptedAndARetryIsADuplicate() {
        when(repo.insertIfNew(anyString(), any(), anyString(), any())).thenReturn(true, false);

        var first = ingest(KEY, 1);
        var retry = ingest(KEY, 1);

        assertThat(first).isEqualTo(new MeterService.Ingested(MeterService.Result.ACCEPTED, false));
        assertThat(retry).isEqualTo(new MeterService.Ingested(MeterService.Result.DUPLICATE, false));
        assertThat(spool.count()).isZero();
    }

    @Test
    void withTheDatabaseDownTheReadingIsParkedAndAcceptedOnlyOnceItIsOnDisk() {
        databaseDown();

        var result = ingest(KEY, 1);

        assertThat(result).isEqualTo(new MeterService.Ingested(MeterService.Result.ACCEPTED, true));
        assertThat(spool.count()).isEqualTo(1);
        assertThat(spool.contains(KEY)).as("durable before the answer").isTrue();
    }

    @Test
    void aRetryWhileTheReadingIsStillParkedIsADuplicateNotAnotherCopy() {
        databaseDown();
        ingest(KEY, 1);

        var retry = ingest(KEY, 1);
        var again = ingest(KEY, 1);

        assertThat(retry).isEqualTo(new MeterService.Ingested(MeterService.Result.DUPLICATE, true));
        assertThat(again.result()).isEqualTo(MeterService.Result.DUPLICATE);
        assertThat(spool.count()).isEqualTo(1);
    }

    @Test
    void aRetryAfterTheDatabaseIsBackStillFindsTheParkedReading() {
        databaseDown();
        ingest(KEY, 1);
        org.mockito.Mockito.reset(repo);
        when(repo.insertIfNew(anyString(), any(), anyString(), any())).thenReturn(true);

        var retry = ingest(KEY, 1);

        assertThat(retry.result()).as("it is parked, so it is already accepted").isEqualTo(MeterService.Result.DUPLICATE);
        verify(repo, never()).insertIfNew(anyString(), any(), anyString(), any());
    }

    @Test
    void onceTheCircuitIsOpenTheDatabaseIsNotCalledAtAll() {
        databaseDown();
        for (int i = 1; i <= 3; i++) {
            ingest("key-" + i, i); // three failures open the circuit
        }
        assertThat(guard.isOpen(Storage.DB)).isTrue();
        org.mockito.Mockito.clearInvocations(repo);

        var result = ingest("key-4", 4);

        assertThat(result.spooled()).isTrue();
        verify(repo, never()).insertIfNew(anyString(), any(), anyString(), any());
        assertThat(spool.count()).isEqualTo(4);
    }

    @Test
    void differentReadingsAreParkedSeparately() {
        databaseDown();

        ingest("a", 1);
        ingest("b", 2);

        assertThat(spool.count()).isEqualTo(2);
    }

    @Test
    void dataTheDatabaseRejectsIsNotParkedForever() {
        doThrow(new DataIntegrityViolationException("bad value")).when(repo)
                .insertIfNew(anyString(), any(), anyString(), any());

        assertThatThrownBy(() -> ingest(KEY, 1)).isInstanceOf(DataIntegrityViolationException.class);

        assertThat(spool.count()).isZero();
        assertThat(guard.allows(Storage.DB)).as("and it does not count against the database circuit").isTrue();
    }

    @Test
    void ifNeitherTheDatabaseNorTheSpoolCanTakeItTheMeterIsToldToRetry() throws Exception {
        databaseDown();
        Path blocker = Files.createFile(spoolDir.resolve("blocker"));
        MeterService broken = new MeterService(repo, MeterSpoolTest.mapper(), guard, new TransactionTemplate() {
            @Override
            public <T> T execute(TransactionCallback<T> action) {
                return action.doInTransaction(null);
            }
        }, new MeterSpool(blocker.toString(), MeterSpoolTest.mapper()));

        assertThatThrownBy(() -> broken.ingest(KEY, MeterSpoolTest.reading("RO-MT-1", 1), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status().value()).isEqualTo(503));
    }
}
