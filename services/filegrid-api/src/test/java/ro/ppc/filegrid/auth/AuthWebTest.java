package ro.ppc.filegrid.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.tracing.Tracer;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import ro.ppc.filegrid.common.GlobalExceptionHandler;
import ro.ppc.filegrid.domain.Role;
import ro.ppc.filegrid.files.FileController;
import ro.ppc.filegrid.files.FileRepository;
import ro.ppc.filegrid.files.FileRow;
import ro.ppc.filegrid.files.FileService;
import ro.ppc.filegrid.files.ReceiptSigner;
import ro.ppc.filegrid.files.dto.FileReceipt;
import ro.ppc.filegrid.health.HealthController;
import ro.ppc.filegrid.meters.MeterController;
import ro.ppc.filegrid.meters.MeterService;
import ro.ppc.filegrid.metrics.FileGridMetrics;

/**
 * Runs the real AuthFilter, controllers and error handler with the database and storages
 * mocked out, so every route's 401/403/404 behaviour is checked without a running stack.
 */
@WebMvcTest(controllers = {AuthController.class, FileController.class, MeterController.class,
        HealthController.class},
        properties = {
                "JWT_SECRET=unit-test-signing-key-not-a-real-secret",
                "DEMO_PASSWORD=demo-pass",
                "METER_DEVICE_TOKEN=device-secret-token"})
@Import({JwtService.class, DownloadTokenService.class, AuthFilter.class, GlobalExceptionHandler.class})
class AuthWebTest {

    private static final String METER_BODY = """
            {"meterId":"RO-MT-1","region":"muntenia","periodStart":"2026-11-14T10:00:00Z","seq":1,
             "intervals":[{"ts":"2026-11-14T10:00:00Z","kwh":0.2}]}""";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper json;

    @MockitoBean FileService fileService;
    @MockitoBean FileRepository fileRepository;
    @MockitoBean ReceiptSigner receiptSigner;
    @MockitoBean MeterService meterService;
    @MockitoBean FileGridMetrics metrics;
    @MockitoBean Tracer tracer;

    @BeforeEach
    void stubs() {
        when(fileRepository.search(any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new FileRepository.SearchResult(List.of(), 0));
        when(meterService.ingest(any(), any(), any()))
                .thenReturn(new MeterService.Ingested(MeterService.Result.ACCEPTED, false));
    }

    private String bearer(Role role) {
        return "Bearer " + jwt.issue(role.wire(), role).token();
    }

    private static String login(String user, String pass) {
        return "{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}";
    }

    // --- health and login are open ---

    @Test
    void healthNeedsNoToken() throws Exception {
        mvc.perform(get("/api/v1/health")).andExpect(status().isOk());
    }

    @Test
    void loginReturnsASessionForADemoUser() throws Exception {
        String body = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(login("dispatch", "demo-pass")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("dispatch"))
                .andExpect(jsonPath("$.username").value("dispatch"))
                .andExpect(jsonPath("$.expiresAt").exists())
                .andReturn().getResponse().getContentAsString();
        JsonNode session = json.readTree(body);

        // The issued token works on a protected route.
        mvc.perform(get("/api/v1/files").header("Authorization", "Bearer " + session.get("token").asText()))
                .andExpect(status().isOk());
    }

    @Test
    void loginRejectsABadPasswordWith401() throws Exception {
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(login("dispatch", "wrong")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void loginGivesTheSame401ForAnUnknownUserAndForTheMeterDeviceRole() throws Exception {
        for (String user : new String[] {"nobody", "meter-device", "download-link"}) {
            mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                            .content(login(user, "demo-pass")))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.message").value("invalid username or password"));
        }
    }

    @Test
    void loginWithAMissingFieldIs400() throws Exception {
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    // --- /files needs a bearer token ---

    @Test
    void searchWithoutATokenIs401() throws Exception {
        mvc.perform(get("/api/v1/files"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void uploadWithoutATokenIs401() throws Exception {
        mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "a.bin", "application/octet-stream", new byte[] {1}))
                        .param("category", "outage"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aGarbageOrForgedTokenIs401() throws Exception {
        mvc.perform(get("/api/v1/files").header("Authorization", "Bearer not-a-token"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/files").header("Authorization", "Basic YWRtaW46YWRtaW4="))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aSessionTokenCanSearch() throws Exception {
        mvc.perform(get("/api/v1/files").header("Authorization", bearer(Role.CONNECTIONS)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
    }

    // --- meter device token ---

    @Test
    void theDeviceTokenCanPostMeterReadings() throws Exception {
        mvc.perform(post("/api/v1/meter-readings").header("Authorization", "Bearer device-secret-token")
                        .header("Idempotency-Key", "RO-MT-1:2026-11-14T10:00:00Z:1")
                        .contentType(MediaType.APPLICATION_JSON).content(METER_BODY))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.result").value("accepted"));
    }

    @Test
    void theDeviceTokenCannotReachFiles() throws Exception {
        mvc.perform(get("/api/v1/files").header("Authorization", "Bearer device-secret-token"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void aMeterRequestWithoutAnyTokenIs401() throws Exception {
        mvc.perform(post("/api/v1/meter-readings").header("Idempotency-Key", "k")
                        .contentType(MediaType.APPLICATION_JSON).content(METER_BODY))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aHumanRoleCannotPostMeterReadings() throws Exception {
        mvc.perform(post("/api/v1/meter-readings").header("Authorization", bearer(Role.DISPATCH))
                        .header("Idempotency-Key", "k")
                        .contentType(MediaType.APPLICATION_JSON).content(METER_BODY))
                .andExpect(status().isForbidden());
    }

    @Test
    void aMeterCategoryAtCapacityAnswers503WithRetryAfter() throws Exception {
        when(meterService.ingest(any(), any(), any())).thenThrow(new ro.ppc.filegrid.resilience.BulkheadFullException(
                ro.ppc.filegrid.domain.Category.METER, ro.ppc.filegrid.resilience.BulkheadFullException.Reason.QUEUE_FULL));

        mvc.perform(post("/api/v1/meter-readings").header("Authorization", "Bearer device-secret-token")
                        .header("Idempotency-Key", "k").contentType(MediaType.APPLICATION_JSON).content(METER_BODY))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("STORAGE_UNAVAILABLE"));
    }

    @Test
    void aMalformedMeterBodyIs400NotAServerError() throws Exception {
        mvc.perform(post("/api/v1/meter-readings").header("Authorization", "Bearer device-secret-token")
                        .header("Idempotency-Key", "k")
                        .contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    // --- unknown routes ---

    @Test
    void anUnknownRouteIs404NotAServerError() throws Exception {
        mvc.perform(get("/api/v1/nope").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(post("/api/v1/nope").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/nothing/here").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(status().isNotFound());
    }

    @Test
    void aWrongMethodIs405() throws Exception {
        mvc.perform(post("/api/v1/health"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    @Test
    void aMalformedFileIdIs400() throws Exception {
        mvc.perform(get("/api/v1/files/not-a-uuid").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(status().isBadRequest());
    }

    // --- force-storage is admin only ---

    @Test
    void onlyAnAdminMaySetForceStorage() throws Exception {
        when(fileService.store(any(), any(FileService.BodySource.class))).thenReturn(new FileReceipt(UUID.randomUUID().toString(),
                "outage", "db", 1, "ab", OffsetDateTime.now(), false, null, "sig"));
        var file = new MockMultipartFile("file", "a.bin", "application/octet-stream", new byte[] {1});

        mvc.perform(multipart("/api/v1/files").file(file).param("category", "outage")
                        .header("X-FileGrid-Force-Storage", "db").header("Authorization", bearer(Role.DISPATCH)))
                .andExpect(status().isForbidden());
        mvc.perform(multipart("/api/v1/files").file(file).param("category", "outage")
                        .header("X-FileGrid-Force-Storage", "db").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(status().isCreated());
        mvc.perform(multipart("/api/v1/files").file(file).param("category", "outage")
                        .header("Authorization", bearer(Role.DISPATCH)))
                .andExpect(status().isCreated());
    }

    // --- download links ---

    private FileRow row(UUID id) {
        return new FileRow(id, "document", "ftp", id.toString(), 5, "ab".repeat(32), "text/plain", null, null,
                null, null, "connections", false, "stored", null, OffsetDateTime.now(), null);
    }

    @Test
    void aDownloadLinkStreamsTheFileWithoutABearerHeader() throws Exception {
        UUID id = UUID.randomUUID();
        when(fileService.mintLinkFor(eq(id), any())).thenReturn(row(id));
        when(fileService.openForDownload(eq(id), any())).thenReturn(new FileService.DownloadStream(
                new ByteArrayInputStream("hello".getBytes(StandardCharsets.UTF_8)), "ab".repeat(32), 5, "text/plain"));

        String body = mvc.perform(post("/api/v1/files/" + id + "/download-link")
                        .header("Authorization", bearer(Role.CONNECTIONS)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sha256").value("ab".repeat(32)))
                .andExpect(jsonPath("$.expiresAt").exists())
                .andReturn().getResponse().getContentAsString();
        String url = json.readTree(body).get("url").asText();
        org.assertj.core.api.Assertions.assertThat(url).startsWith("/api/v1/files/" + id + "/content?token=v1.");

        // No Authorization header: the token in the URL is the only credential.
        mvc.perform(get(url))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Content-SHA256", "ab".repeat(32)))
                .andExpect(content().string("hello"));
    }

    @Test
    void aDownloadLinkDoesNotWorkForAnotherFile() throws Exception {
        UUID id = UUID.randomUUID();
        when(fileService.mintLinkFor(eq(id), any())).thenReturn(row(id));
        String url = json.readTree(mvc.perform(post("/api/v1/files/" + id + "/download-link")
                        .header("Authorization", bearer(Role.ADMIN)))
                .andReturn().getResponse().getContentAsString()).get("url").asText();
        String token = url.substring(url.indexOf("token=") + 6);

        mvc.perform(get("/api/v1/files/" + UUID.randomUUID() + "/content?token=" + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aDownloadTokenCannotMintAnotherLinkOrVerify() throws Exception {
        UUID id = UUID.randomUUID();
        when(fileService.mintLinkFor(eq(id), any())).thenReturn(row(id));
        String url = json.readTree(mvc.perform(post("/api/v1/files/" + id + "/download-link")
                        .header("Authorization", bearer(Role.ADMIN)))
                .andReturn().getResponse().getContentAsString()).get("url").asText();
        String token = url.substring(url.indexOf("token=") + 6);

        mvc.perform(post("/api/v1/files/" + id + "/download-link?token=" + token))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/files/" + id + "/verify?token=" + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aDownloadLinkForAnUnknownFileIs404() throws Exception {
        UUID id = UUID.randomUUID();
        when(fileService.mintLinkFor(eq(id), any())).thenThrow(ro.ppc.filegrid.common.ApiException.notFound("no file"));

        mvc.perform(post("/api/v1/files/" + id + "/download-link").header("Authorization", bearer(Role.ADMIN)))
                .andExpect(status().isNotFound());
    }
}
