package ro.ppc.filegrid.policy;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.micrometer.tracing.Tracer;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import ro.ppc.filegrid.auth.AuthFilter;
import ro.ppc.filegrid.auth.DownloadTokenService;
import ro.ppc.filegrid.auth.JwtService;
import ro.ppc.filegrid.common.GlobalExceptionHandler;
import ro.ppc.filegrid.domain.Role;

/** The policy routes: who may read, who may change, and what a refused change looks like. */
@WebMvcTest(controllers = PolicyController.class,
        properties = {"JWT_SECRET=unit-test-signing-key-not-a-real-secret"})
@Import({JwtService.class, DownloadTokenService.class, AuthFilter.class, GlobalExceptionHandler.class})
class PolicyWebTest {

    private static final String BODY = """
            {"version":1,"categories":{
              "meter":{"primary":"db","fallback":"spool","encrypt":false,"maxSizeMb":1,"priority":"high","workers":16,"queue":5000},
              "outage":{"primary":"db","fallback":"s3","encrypt":false,"maxSizeMb":20,"priority":"high","workers":8,"queue":500},
              "document":{"primary":"ftp","fallback":"s3","encrypt":true,"maxSizeMb":20,"priority":"normal","workers":4,"queue":200,"audit":true},
              "video":{"primary":"s3","fallback":"spool","encrypt":false,"maxSizeMb":5000,"priority":"low","workers":2,"queue":20,"chunkMb":16}}}""";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;

    @MockitoBean PolicyService policyService;
    @MockitoBean PolicyManager manager;
    @MockitoBean Tracer tracer;

    private String bearer(Role role) {
        return "Bearer " + jwt.issue(role.wire(), role).token();
    }

    private static Policy policy(int version, String outagePrimary) {
        CategoryPolicy meter = new CategoryPolicy("db", "spool", false, 1, "high", 16, 5000, false, null);
        CategoryPolicy outage = new CategoryPolicy(outagePrimary, "s3", false, 20, "high", 8, 500, false, null);
        return new Policy(version, Map.of("meter", meter, "outage", outage));
    }

    @Test
    void everyoneLoggedInCanReadThePolicyAndItsHistory() throws Exception {
        when(policyService.current()).thenReturn(policy(3, "s3"));
        when(manager.history()).thenReturn(List.of(
                new PolicyVersion(3, OffsetDateTime.parse("2026-11-14T17:00:00Z"), "admin", policy(3, "s3")),
                new PolicyVersion(2, OffsetDateTime.parse("2026-11-14T16:00:00Z"), "file", policy(2, "db"))));

        for (Role role : new Role[] {Role.FIELD, Role.DISPATCH, Role.CONNECTIONS, Role.ADMIN}) {
            mvc.perform(get("/api/v1/policy").header("Authorization", bearer(role)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.version").value(3))
                    .andExpect(jsonPath("$.categories.outage.primary").value("s3"))
                    .andExpect(jsonPath("$.categories.meter.audit").value(false));
            mvc.perform(get("/api/v1/policy/history").header("Authorization", bearer(role)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].version").value(3))
                    .andExpect(jsonPath("$[0].appliedBy").value("admin"))
                    .andExpect(jsonPath("$[0].appliedAt").exists())
                    .andExpect(jsonPath("$[1].policy.categories.outage.primary").value("db"));
        }
    }

    @Test
    void thePolicyJsonOmitsAnUnsetChunkSizeSoItMatchesTheSchema() throws Exception {
        when(policyService.current()).thenReturn(policy(1, "s3"));

        mvc.perform(get("/api/v1/policy").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(jsonPath("$.categories.meter.chunkMb").doesNotExist());
    }

    @Test
    void noTokenIs401() throws Exception {
        mvc.perform(get("/api/v1/policy")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/policy").contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/policy/history")).andExpect(status().isUnauthorized());
    }

    @Test
    void anAdminCanApplyAPolicyAndGetsTheOneNowInForce() throws Exception {
        when(manager.apply(any(), eq("admin"))).thenReturn(policy(4, "db"));

        mvc.perform(put("/api/v1/policy").header("Authorization", bearer(Role.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(4))
                .andExpect(jsonPath("$.categories.outage.primary").value("db"));
    }

    @Test
    void nobodyButAnAdminMayChangeIt() throws Exception {
        for (Role role : new Role[] {Role.FIELD, Role.DISPATCH, Role.CONNECTIONS}) {
            mvc.perform(put("/api/v1/policy").header("Authorization", bearer(role))
                            .contentType(MediaType.APPLICATION_JSON).content(BODY))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        }
        verify(manager, never()).apply(any(), any());
    }

    @Test
    void theMeterDeviceTokenCannotTouchThePolicyEither() throws Exception {
        mvc.perform(put("/api/v1/policy").header("Authorization", bearer(Role.METER_DEVICE))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isForbidden());
    }

    @Test
    void aPolicyThatDoesNotValidateIs400WithTheReasons() throws Exception {
        when(manager.apply(any(), any())).thenThrow(new PolicyValidationException(
                List.of("$.categories.outage.primary: does not have a value in the enumeration [db, s3, ftp]")));

        mvc.perform(put("/api/v1/policy").header("Authorization", bearer(Role.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("outage.primary")));
    }

    @Test
    void aBodyThatIsNotJsonIs400NotAServerError() throws Exception {
        mvc.perform(put("/api/v1/policy").header("Authorization", bearer(Role.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    @Test
    void aPutWithNoBodyIs400() throws Exception {
        mvc.perform(put("/api/v1/policy").header("Authorization", bearer(Role.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest());
    }
}
