package ro.ppc.filegrid.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.observation.Observation;
import org.junit.jupiter.api.Test;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class TraceNoiseFilterTest {

    private final TraceNoiseFilter filter = new TraceNoiseFilter();

    private boolean kept(String method, String path) {
        var ctx = new ServerRequestObservationContext(new MockHttpServletRequest(method, path), new MockHttpServletResponse());
        return filter.test("http.server.requests", ctx);
    }

    @Test
    void healthChecksScrapesAndTheStorageHealthPageAreNotTraced() {
        assertThat(kept("GET", "/api/v1/health")).isFalse();
        assertThat(kept("GET", "/api/v1/storages/health")).isFalse();
        assertThat(kept("GET", "/actuator/prometheus")).isFalse();
        assertThat(kept("GET", "/actuator/health/liveness")).isFalse();
    }

    @Test
    void realWorkIsTraced() {
        assertThat(kept("POST", "/api/v1/files")).isTrue();
        assertThat(kept("GET", "/api/v1/files/6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60/content")).isTrue();
        assertThat(kept("POST", "/api/v1/meter-readings")).isTrue();
        assertThat(kept("PATCH", "/api/v1/files/tus/6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60")).isTrue();
        assertThat(kept("GET", "/api/v1/healthy-looking-name")).as("only the exact health route").isTrue();
        assertThat(kept("PUT", "/api/v1/policy")).isTrue();
    }

    @Test
    void springsOwnScheduledTasksAreNotTraced() {
        assertThat(filter.test("tasks.scheduled.execution", new Observation.Context())).isFalse();
    }

    @Test
    void otherObservationsAreLeftAlone() {
        assertThat(filter.test("jdbc.query", new Observation.Context())).isTrue();
        assertThat(filter.test(null, new Observation.Context())).isTrue();
    }
}
