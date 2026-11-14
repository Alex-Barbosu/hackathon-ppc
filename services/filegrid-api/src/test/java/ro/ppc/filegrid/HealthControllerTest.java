package ro.ppc.filegrid;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.health.HealthController;

class HealthControllerTest {

    @Test
    void reportsUp() {
        var health = new HealthController("test").health();
        assertThat(health.status()).isEqualTo("up");
        assertThat(health.service()).isEqualTo("filegrid-api");
    }
}
