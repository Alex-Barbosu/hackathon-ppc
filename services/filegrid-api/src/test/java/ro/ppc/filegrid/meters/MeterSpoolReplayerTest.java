package ro.ppc.filegrid.meters;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.resilience.StorageGuard;
import ro.ppc.filegrid.spool.SpoolGauges;

class MeterSpoolReplayerTest {

    @TempDir
    Path spoolDir;

    private MeterRepository repo;
    private StorageGuard guard;
    private MeterSpool spool;
    private SpoolGauges gauges;
    private MeterSpoolReplayer replayer;

    @BeforeEach
    void setUp() throws Exception {
        repo = mock(MeterRepository.class);
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        guard = new StorageGuard(registry, 10, 3, 50f, 3600);
        spool = new MeterSpool(spoolDir.toString(), MeterSpoolTest.mapper());
        gauges = new SpoolGauges(registry);
        replayer = new MeterSpoolReplayer(spool, repo, MeterSpoolTest.mapper(), guard, new TransactionTemplate() {
            @Override
            public <T> T execute(TransactionCallback<T> action) {
                return action.doInTransaction(null);
            }
        }, gauges);
        for (int i = 1; i <= 3; i++) {
            spool.put("key-" + i, MeterSpoolTest.reading("RO-MT-" + i, i), "t" + i);
        }
    }

    @Test
    void onceTheDatabaseIsBackEveryParkedReadingIsInsertedAndTheSpoolEmpties() throws Exception {
        when(repo.insertIfNew(anyString(), any(), anyString(), any())).thenReturn(true);

        int done = replayer.replay();

        assertThat(done).isEqualTo(3);
        assertThat(spool.count()).isZero();
        verify(repo).insertIfNew(eq("key-1"), any(), anyString(), eq("t1"));
        verify(repo).insertIfNew(eq("key-2"), any(), anyString(), eq("t2"));
        verify(repo).insertIfNew(eq("key-3"), any(), anyString(), eq("t3"));
    }

    @Test
    void aReadingThatIsAlreadyInTheDatabaseIsNotInsertedTwiceAndStillLeavesTheSpool() throws Exception {
        // insertIfNew is ON CONFLICT DO NOTHING: false means "already there".
        when(repo.insertIfNew(anyString(), any(), anyString(), any())).thenReturn(false);

        assertThat(replayer.replay()).isEqualTo(3);

        assertThat(spool.count()).isZero();
    }

    @Test
    void whileTheDatabaseIsStillDownNothingIsLostAndTheLoopStopsAtTheFirstFailure() throws Exception {
        when(repo.insertIfNew(anyString(), any(), anyString(), any()))
                .thenThrow(new CannotGetJdbcConnectionException("connection refused"));

        assertThat(replayer.replay()).isZero();

        assertThat(spool.count()).as("all three are still parked").isEqualTo(3);
        verify(repo, times(1)).insertIfNew(anyString(), any(), anyString(), any());
        assertThat(spool.claim(10)).as("and they are released for the next round").hasSize(3);
    }

    @Test
    void anOpenCircuitMeansTheDatabaseIsNotTriedAtAll() throws Exception {
        for (int i = 0; i < 3; i++) {
            try {
                guard.call(Storage.DB, () -> {
                    throw new java.io.IOException("down");
                });
            } catch (RuntimeException expected) {
                // opens the circuit
            }
        }

        assertThat(replayer.replay()).isZero();

        verify(repo, never()).insertIfNew(anyString(), any(), anyString(), any());
        assertThat(spool.count()).isEqualTo(3);
    }

    @Test
    void aReadingTheDatabaseWillNeverAcceptIsSetAsideSoTheOthersGetThrough() throws Exception {
        when(repo.insertIfNew(eq("key-1"), any(), anyString(), any())).thenThrow(new DataIntegrityViolationException("bad"));
        when(repo.insertIfNew(eq("key-2"), any(), anyString(), any())).thenReturn(true);
        when(repo.insertIfNew(eq("key-3"), any(), anyString(), any())).thenReturn(true);

        int done = replayer.replay();

        assertThat(done).isEqualTo(2);
        assertThat(spool.count()).isZero();
        assertThat(spoolDir.resolve("meter/rejected")).isDirectory();
    }

    @Test
    void theScheduledRunKeepsThePendingGaugeCurrent() {
        when(repo.insertIfNew(anyString(), any(), anyString(), any())).thenReturn(true);
        gauges.set(Category.METER, 99);

        replayer.run();

        assertThat(gauges.get(Category.METER)).isZero();
    }

    @Test
    void theGaugeShowsWhatIsStillWaiting() {
        when(repo.insertIfNew(anyString(), any(), anyString(), any()))
                .thenThrow(new CannotGetJdbcConnectionException("down"));

        replayer.run();

        assertThat(gauges.get(Category.METER)).isEqualTo(3);
    }
}
