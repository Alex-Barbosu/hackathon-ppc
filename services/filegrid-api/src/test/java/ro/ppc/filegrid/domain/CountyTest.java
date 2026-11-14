package ro.ppc.filegrid.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class CountyTest {

    @Test
    void theRegionComesFromTheCountyWhenNotGiven() {
        assertThat(County.resolve(null, "Timiș")).isEqualTo(new County.Place("banat", "Timiș"));
        assertThat(County.resolve("dobrogea", "Constanța")).isEqualTo(new County.Place("dobrogea", "Constanța"));
    }

    @Test
    void aCountyOutsideTheRegionIsRefused() {
        assertThatThrownBy(() -> County.resolve("muntenia", "Timiș"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("county Timiș is not in region muntenia");
    }

    @Test
    void namesWithoutDiacriticsOrWithCedillasAreTheSameCounty() {
        // Stored with the contract's comma-below letters whatever the client sent.
        assertThat(County.resolve(null, "timis").county()).isEqualTo("Timiș");
        assertThat(County.resolve(null, "Constanţa").county()).isEqualTo("Constanța");
        assertThat(County.resolve(null, "Caras Severin").county()).isEqualTo("Caraș-Severin");
        assertThat(County.resolve(null, "BUCURESTI").county()).isEqualTo("București");
    }

    @Test
    void anUnknownCountyIsRefusedAndNoCountyIsFine() {
        assertThatThrownBy(() -> County.resolve(null, "Cluj")).hasMessage("unknown county");
        assertThat(County.resolve("banat", null)).isEqualTo(new County.Place("banat", null));
        assertThat(County.resolve(null, " ")).isEqualTo(new County.Place(null, null));
    }

    @Test
    void everyCountyIsInOneOfTheThreeRegions() {
        for (County c : County.values()) {
            assertThat(County.fromName(c.displayName())).isEqualTo(c);
            assertThat(c.region()).isNotNull();
        }
        assertThat(County.values()).hasSize(11);
    }
}
