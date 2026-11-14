package ro.ppc.filegrid.observability;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationPredicate;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import org.springframework.stereotype.Component;

/**
 * Keeps the trace list about work people care about. Health checks (the gateway and compose call them every
 * few seconds), the Prometheus scrape, the storage-health page and Spring's own scheduled tasks (policy sync,
 * probes, replay ticks) each made a trace that held nothing, so the traces of real uploads were hard to find.
 *
 * <p>Only the automatic observation is dropped. The spans in this package ({@link Spans}) are not observations, so
 * the writes a scheduled replay does still produce their own trace.
 */
@Component
public class TraceNoiseFilter implements ObservationPredicate {

    private static final String[] QUIET_PATHS = {"/api/v1/health", "/api/v1/storages/health", "/actuator"};

    @Override
    public boolean test(String name, Observation.Context context) {
        if (name != null && name.startsWith("tasks.scheduled")) {
            return false;
        }
        if (context instanceof ServerRequestObservationContext http) {
            String path = http.getCarrier().getRequestURI();
            for (String quiet : QUIET_PATHS) {
                if (path.equals(quiet) || path.startsWith(quiet + "/")) {
                    return false;
                }
            }
        }
        return true;
    }
}
