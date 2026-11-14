package ro.ppc.filegrid.auth;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.domain.Role;

class AccessRulesTest {

    private static final String FILE = "/api/v1/files/6f1c2b8e-3a1d-4f7e-9c0a-1b2c3d4e5f60";

    @Test
    void meterDeviceReachesOnlyMeterReadings() {
        assertThat(AccessRules.allowed(Role.METER_DEVICE, "POST", "/api/v1/meter-readings")).isTrue();
        assertThat(AccessRules.allowed(Role.METER_DEVICE, "GET", "/api/v1/meter-readings")).isFalse();
        assertThat(AccessRules.allowed(Role.METER_DEVICE, "GET", "/api/v1/files")).isFalse();
        assertThat(AccessRules.allowed(Role.METER_DEVICE, "GET", FILE + "/content")).isFalse();
        assertThat(AccessRules.allowed(Role.METER_DEVICE, "GET", "/api/v1/policy")).isFalse();
    }

    @Test
    void downloadTokenReachesOnlyFileContent() {
        assertThat(AccessRules.allowed(Role.DOWNLOAD_LINK, "GET", FILE + "/content")).isTrue();
        assertThat(AccessRules.allowed(Role.DOWNLOAD_LINK, "POST", FILE + "/content")).isFalse();
        assertThat(AccessRules.allowed(Role.DOWNLOAD_LINK, "POST", FILE + "/download-link")).isFalse();
        assertThat(AccessRules.allowed(Role.DOWNLOAD_LINK, "POST", FILE + "/verify")).isFalse();
        assertThat(AccessRules.allowed(Role.DOWNLOAD_LINK, "GET", "/api/v1/files")).isFalse();
    }

    @Test
    void humanRolesUseTheApiButNotTheMeterRoute() {
        for (Role r : new Role[] {Role.FIELD, Role.DISPATCH, Role.CONNECTIONS}) {
            assertThat(AccessRules.allowed(r, "POST", "/api/v1/files")).isTrue();
            assertThat(AccessRules.allowed(r, "GET", "/api/v1/files")).isTrue();
            assertThat(AccessRules.allowed(r, "POST", "/api/v1/meter-readings")).isFalse();
        }
    }

    @Test
    void everyoneLoggedInReadsThePolicyButOnlyAnAdminChangesIt() {
        for (Role r : new Role[] {Role.FIELD, Role.DISPATCH, Role.CONNECTIONS}) {
            assertThat(AccessRules.allowed(r, "GET", "/api/v1/policy")).isTrue();
            assertThat(AccessRules.allowed(r, "GET", "/api/v1/policy/history")).isTrue();
            assertThat(AccessRules.allowed(r, "PUT", "/api/v1/policy")).isFalse();
            assertThat(AccessRules.allowed(r, "POST", "/api/v1/policy")).isFalse();
            assertThat(AccessRules.allowed(r, "DELETE", "/api/v1/policy/history")).isFalse();
        }
        assertThat(AccessRules.allowed(Role.ADMIN, "PUT", "/api/v1/policy")).isTrue();
        assertThat(AccessRules.allowed(Role.METER_DEVICE, "GET", "/api/v1/policy")).isFalse();
        assertThat(AccessRules.allowed(Role.DOWNLOAD_LINK, "GET", "/api/v1/policy")).isFalse();
    }

    @Test
    void adminReachesEverything() {
        assertThat(AccessRules.allowed(Role.ADMIN, "POST", "/api/v1/meter-readings")).isTrue();
        assertThat(AccessRules.allowed(Role.ADMIN, "POST", "/api/v1/files")).isTrue();
    }

    @Test
    void onlyHealthLoginAndActuatorArePublic() {
        assertThat(AccessRules.isPublic("/api/v1/health")).isTrue();
        assertThat(AccessRules.isPublic("/api/v1/auth/login")).isTrue();
        assertThat(AccessRules.isPublic("/actuator/prometheus")).isTrue();
        assertThat(AccessRules.isPublic("/api/v1/files")).isFalse();
        assertThat(AccessRules.isPublic("/api/v1/healthz")).isFalse();
        assertThat(AccessRules.isPublic("/api/v1/auth/login/x")).isFalse();
        assertThat(AccessRules.isPublic("/api/v1/policy")).isFalse();
    }
}
