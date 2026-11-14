package ro.ppc.filegrid.resilience;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.domain.Storage;
import ro.ppc.filegrid.storage.StorageAdapter;
import ro.ppc.filegrid.storage.StorageRegistry;

/**
 * The probe loop feeds the circuit breaker, so a circuit opens and closes with no user traffic,
 * and it publishes filegrid_storage_up.
 */
class StorageMonitorTest {

    private SimpleMeterRegistry registry;
    private StorageGuard guard;
    private StorageAdapter db;
    private StorageAdapter s3;
    private StorageAdapter ftp;
    private StorageMonitor monitor;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        guard = new StorageGuard(registry, 10, 3, 50f, 3600);
        db = adapter(Storage.DB);
        s3 = adapter(Storage.S3);
        ftp = adapter(Storage.FTP);
        StorageRegistry storages = mock(StorageRegistry.class);
        when(storages.get(Storage.DB)).thenReturn(db);
        when(storages.get(Storage.S3)).thenReturn(s3);
        when(storages.get(Storage.FTP)).thenReturn(ftp);
        monitor = new StorageMonitor(storages, guard, registry);
    }

    private static StorageAdapter adapter(Storage kind) {
        StorageAdapter a = mock(StorageAdapter.class);
        when(a.kind()).thenReturn(kind);
        when(a.health()).thenReturn(true);
        return a;
    }

    private double up(Storage s) {
        return registry.get("filegrid.storage.up").tag("storage", s.slug()).gauge().value();
    }

    private StorageMonitor.Snapshot of(Storage s) {
        return monitor.snapshot().stream().filter(x -> x.storage() == s).findFirst().orElseThrow();
    }

    @Test
    void healthyStoragesReportUpWithAClosedCircuit() {
        monitor.probeAll();

        for (Storage s : new Storage[] {Storage.DB, Storage.S3, Storage.FTP}) {
            assertThat(of(s).up()).isTrue();
            assertThat(of(s).circuitOpen()).isFalse();
            assertThat(up(s)).isEqualTo(1.0);
        }
    }

    @Test
    void aStorageThatFailsItsProbeIsReportedDownAndEventuallyItsCircuitOpensWithNoTraffic() {
        when(s3.health()).thenReturn(false);

        monitor.probeAll();
        assertThat(of(Storage.S3).up()).isFalse();
        assertThat(up(Storage.S3)).isZero();
        assertThat(of(Storage.S3).circuitOpen()).as("one failed probe is not enough").isFalse();

        monitor.probeAll();
        monitor.probeAll();

        assertThat(of(Storage.S3).circuitOpen()).as("three failed probes open it").isTrue();
        assertThat(of(Storage.DB).up()).as("the others are untouched").isTrue();
        assertThat(of(Storage.FTP).circuitOpen()).isFalse();
    }

    @Test
    void anOpenCircuitIsNotProbedSoADeadStorageIsLeftAlone() {
        when(s3.health()).thenReturn(false);
        monitor.probeAll();
        monitor.probeAll();
        monitor.probeAll();
        org.mockito.Mockito.clearInvocations(s3);

        monitor.probeAll();
        monitor.probeAll();

        verify(s3, never()).health();
        assertThat(of(Storage.S3).up()).isFalse();
    }

    @Test
    void whenTheStorageComesBackTheFirstProbeAfterTheWaitClosesTheCircuit() {
        when(s3.health()).thenReturn(false);
        monitor.probeAll();
        monitor.probeAll();
        monitor.probeAll();
        assertThat(guard.isOpen(Storage.S3)).isTrue();

        when(s3.health()).thenReturn(true);
        guard.breaker(Storage.S3).transitionToHalfOpenState(); // the open wait has passed
        monitor.probeAll();
        monitor.probeAll();

        assertThat(of(Storage.S3).up()).isTrue();
        assertThat(of(Storage.S3).circuitOpen()).isFalse();
        assertThat(up(Storage.S3)).isEqualTo(1.0);
    }

    @Test
    void aProbeThatThrowsCountsAsDownToo() {
        when(ftp.health()).thenThrow(new IllegalStateException("tls handshake failed"));

        monitor.probeAll();

        assertThat(of(Storage.FTP).up()).isFalse();
    }

    @Test
    void theSnapshotProbesOnceIfNothingHasRunYetAndAfterThatDoesNotCallTheBackends() {
        monitor.snapshot();
        monitor.snapshot();
        monitor.snapshot();

        verify(s3, times(1)).health();
    }

    @Test
    void theMonitoredStoragesAreExactlyTheContractsThree() {
        assertThat(monitor.snapshot()).extracting(StorageMonitor.Snapshot::storage)
                .containsExactly(Storage.DB, Storage.S3, Storage.FTP);
    }
}
