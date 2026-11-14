package ro.ppc.filegrid.resilience;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.domain.Storage;

class StorageGuardTest {

    private SimpleMeterRegistry registry;
    private StorageGuard guard;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        // Long open wait: these tests move the circuit by hand instead of waiting.
        guard = new StorageGuard(registry, 10, 3, 50f, 3600);
    }

    private void failOnce(Storage s) {
        assertThatThrownBy(() -> guard.call(s, () -> {
            throw new IOException("connection refused");
        })).isInstanceOf(StorageDownException.class);
    }

    private double circuitGauge(Storage s) {
        return registry.get("filegrid.circuit.open").tag("storage", s.slug()).gauge().value();
    }

    @Test
    void aSuccessfulCallReturnsItsResult() {
        assertThat(guard.call(Storage.S3, () -> "ok")).isEqualTo("ok");
        assertThat(guard.allows(Storage.S3)).isTrue();
        assertThat(circuitGauge(Storage.S3)).isZero();
    }

    @Test
    void aFailureIsReportedAsStorageDownWithTheCause() {
        assertThatThrownBy(() -> guard.call(Storage.FTP, () -> {
            throw new IOException("boom");
        })).isInstanceOfSatisfying(StorageDownException.class, e -> {
            assertThat(e.storage()).isEqualTo(Storage.FTP);
            assertThat(e.circuitOpen()).isFalse();
            assertThat(e.getCause()).hasMessage("boom");
        });
    }

    @Test
    void afterAFewFailuresTheCircuitOpensAndTheBackendIsNotCalledAgain() {
        for (int i = 0; i < 3; i++) {
            failOnce(Storage.S3);
        }
        assertThat(guard.isOpen(Storage.S3)).isTrue();
        assertThat(circuitGauge(Storage.S3)).isEqualTo(1.0);

        AtomicInteger calls = new AtomicInteger();
        assertThatThrownBy(() -> guard.call(Storage.S3, () -> calls.incrementAndGet()))
                .isInstanceOfSatisfying(StorageDownException.class, e -> assertThat(e.circuitOpen()).isTrue());
        assertThat(calls).as("an open circuit does not touch the backend").hasValue(0);
    }

    @Test
    void oneStoragesCircuitDoesNotAffectTheOthers() {
        for (int i = 0; i < 3; i++) {
            failOnce(Storage.S3);
        }

        assertThat(guard.allows(Storage.DB)).isTrue();
        assertThat(guard.allows(Storage.FTP)).isTrue();
        assertThat(guard.call(Storage.DB, () -> 1)).isEqualTo(1);
        assertThat(circuitGauge(Storage.DB)).isZero();
        assertThat(circuitGauge(Storage.FTP)).isZero();
    }

    @Test
    void aClientsBrokenConnectionAndOurOwnRefusalsNeverOpenACircuit() {
        for (int i = 0; i < 30; i++) {
            assertThatThrownBy(() -> guard.call(Storage.S3, () -> {
                throw new ClientStreamException(new IOException("client went away"));
            })).isInstanceOf(ClientStreamException.class);
            assertThatThrownBy(() -> guard.call(Storage.S3, () -> {
                throw ApiException.badRequest("nope");
            })).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> guard.call(Storage.DB, () -> {
                throw new DataIntegrityViolationException("bad data");
            })).isInstanceOf(DataIntegrityViolationException.class);
        }

        assertThat(guard.allows(Storage.S3)).isTrue();
        assertThat(guard.allows(Storage.DB)).isTrue();
    }

    @Test
    void successesInTheWindowKeepTheCircuitClosed() {
        // 2 failures out of 10 is below the 50 % threshold, and fewer than the minimum calls anyway.
        for (int i = 0; i < 8; i++) {
            guard.call(Storage.S3, () -> "ok");
        }
        failOnce(Storage.S3);
        failOnce(Storage.S3);

        assertThat(guard.allows(Storage.S3)).isTrue();
    }

    @Test
    void afterTheWaitTwoGoodCallsCloseTheCircuitAgain() {
        for (int i = 0; i < 3; i++) {
            failOnce(Storage.S3);
        }
        guard.breaker(Storage.S3).transitionToHalfOpenState(); // what the open wait does by itself

        assertThat(guard.allows(Storage.S3)).as("half-open lets trial calls through").isTrue();
        guard.call(Storage.S3, () -> "ok");
        guard.call(Storage.S3, () -> "ok");

        assertThat(guard.breaker(Storage.S3).getState().name()).isEqualTo("CLOSED");
        assertThat(circuitGauge(Storage.S3)).isZero();
    }

    @Test
    void aStorageOnTrialStillShowsAsNotTrustedSoTheGaugeDoesNotFlap() {
        for (int i = 0; i < 3; i++) {
            failOnce(Storage.S3);
        }
        assertThat(circuitGauge(Storage.S3)).isEqualTo(1.0);

        guard.breaker(Storage.S3).transitionToHalfOpenState();

        assertThat(guard.allows(Storage.S3)).as("calls may try it").isTrue();
        assertThat(guard.isTripped(Storage.S3)).as("but it is not trusted yet").isTrue();
        assertThat(circuitGauge(Storage.S3)).isEqualTo(1.0);
    }

    @Test
    void aFailedTrialCallOpensTheCircuitAgain() {
        for (int i = 0; i < 3; i++) {
            failOnce(Storage.S3);
        }
        guard.breaker(Storage.S3).transitionToHalfOpenState();

        failOnce(Storage.S3);
        failOnce(Storage.S3);

        assertThat(guard.isOpen(Storage.S3)).isTrue();
        assertThat(circuitGauge(Storage.S3)).isEqualTo(1.0);
    }

    @Test
    void thereIsNoCircuitForTheSpool() {
        assertThat(guard.allows(Storage.SPOOL)).isTrue();
        assertThatThrownBy(() -> guard.call(Storage.SPOOL, () -> "x")).isInstanceOf(IllegalArgumentException.class);
    }
}
