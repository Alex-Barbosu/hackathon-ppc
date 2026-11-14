package ro.ppc.filegrid.tus;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.micrometer.tracing.Tracer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import ro.ppc.filegrid.auth.AuthFilter;
import ro.ppc.filegrid.auth.DownloadTokenService;
import ro.ppc.filegrid.auth.JwtService;
import ro.ppc.filegrid.common.ApiException;
import ro.ppc.filegrid.common.GlobalExceptionHandler;
import ro.ppc.filegrid.domain.Category;
import ro.ppc.filegrid.domain.Role;

/** The tus HTTP rules: required headers, status codes, and that the bearer token is enforced. */
@WebMvcTest(controllers = TusController.class,
        properties = {"JWT_SECRET=unit-test-signing-key-not-a-real-secret"})
@Import({JwtService.class, DownloadTokenService.class, AuthFilter.class, GlobalExceptionHandler.class})
class TusWebTest {

    private static final String OFFSET = "application/offset+octet-stream";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;

    @MockitoBean TusService tus;
    @MockitoBean Tracer tracer;

    private String bearer() {
        return "Bearer " + jwt.issue("field", Role.FIELD).token();
    }

    private static String meta() {
        return "category " + Base64.getEncoder().encodeToString("video".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void everyTusRouteNeedsAToken() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(post("/api/v1/files/tus").header("Tus-Resumable", "1.0.0")).andExpect(status().isUnauthorized());
        mvc.perform(head("/api/v1/files/tus/" + id).header("Tus-Resumable", "1.0.0")).andExpect(status().isUnauthorized());
        mvc.perform(patch("/api/v1/files/tus/" + id).header("Tus-Resumable", "1.0.0")).andExpect(status().isUnauthorized());
    }

    @Test
    void creationReturns201WithALocation() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.create(eq(1000L), any(), eq("field"))).thenReturn(id);

        mvc.perform(post("/api/v1/files/tus").header("Authorization", bearer())
                        .header("Tus-Resumable", "1.0.0").header("Upload-Length", "1000")
                        .header("Upload-Metadata", meta()))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/files/tus/" + id))
                .andExpect(header().string("Tus-Resumable", "1.0.0"));
    }

    @Test
    void aMissingOrWrongTusVersionIs412() throws Exception {
        mvc.perform(post("/api/v1/files/tus").header("Authorization", bearer()).header("Upload-Length", "1"))
                .andExpect(status().isPreconditionFailed());
        mvc.perform(post("/api/v1/files/tus").header("Authorization", bearer())
                        .header("Tus-Resumable", "0.2.2").header("Upload-Length", "1"))
                .andExpect(status().isPreconditionFailed());
    }

    @Test
    void creationNeedsAValidUploadLength() throws Exception {
        mvc.perform(post("/api/v1/files/tus").header("Authorization", bearer()).header("Tus-Resumable", "1.0.0"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/files/tus").header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Length", "abc"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/files/tus").header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Defer-Length", "1"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void headReportsTheOffsetAndLength() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.head(id)).thenReturn(upload(id, 5_000_000L, 20_000_000L));

        mvc.perform(head("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0"))
                .andExpect(status().isOk())
                .andExpect(header().string("Upload-Offset", "5000000"))
                .andExpect(header().string("Upload-Length", "20000000"))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void anUnknownUploadIs404() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.head(id)).thenThrow(ApiException.notFound("no such upload"));

        mvc.perform(head("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0"))
                .andExpect(status().isNotFound());
    }

    @Test
    void patchReturns204WithTheNewOffset() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.append(eq(id), eq(0L), anyLong(), any())).thenReturn(new TusService.PatchResult(3, null));

        mvc.perform(patch("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Offset", "0").contentType(OFFSET).content(new byte[] {1, 2, 3}))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Upload-Offset", "3"))
                .andExpect(header().doesNotExist("X-FileGrid-File-Id"));
    }

    @Test
    void theLastPatchCarriesTheFileId() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.append(eq(id), eq(0L), anyLong(), any())).thenReturn(new TusService.PatchResult(3, id));

        mvc.perform(patch("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Offset", "0").contentType(OFFSET).content(new byte[] {1, 2, 3}))
                .andExpect(status().isNoContent())
                .andExpect(header().string("X-FileGrid-File-Id", id.toString()));
    }

    @Test
    void patchNeedsTheOffsetContentType() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(patch("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Offset", "0").contentType("application/json").content("{}"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
    }

    @Test
    void patchNeedsAnOffset() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(patch("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .contentType(OFFSET).content(new byte[] {1}))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aWrongOffsetFromTheServiceIs409() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.append(eq(id), anyLong(), anyLong(), any())).thenThrow(ApiException.conflict("offset"));

        mvc.perform(patch("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Offset", "7").contentType(OFFSET).content(new byte[] {1}))
                .andExpect(status().isConflict());
    }

    @Test
    void aCategoryAtCapacityAnswers503WithRetryAfterSoTheClientRetries() throws Exception {
        UUID id = UUID.randomUUID();
        when(tus.append(eq(id), anyLong(), anyLong(), any())).thenThrow(new ro.ppc.filegrid.resilience.BulkheadFullException(
                Category.VIDEO, ro.ppc.filegrid.resilience.BulkheadFullException.Reason.QUEUE_FULL));

        mvc.perform(patch("/api/v1/files/tus/" + id).header("Authorization", bearer()).header("Tus-Resumable", "1.0.0")
                        .header("Upload-Offset", "0").contentType(OFFSET).content(new byte[] {1}))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("STORAGE_UNAVAILABLE"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("video")));
    }

    @Test
    void optionsAdvertisesTheCreationExtension() throws Exception {
        mvc.perform(options("/api/v1/files/tus").header("Authorization", bearer()))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Tus-Version", "1.0.0"))
                .andExpect(header().string("Tus-Extension", "creation"));
    }

    private static TusUpload upload(UUID id, long offset, long length) {
        return new TusUpload(id, Category.VIDEO, null, null, null, "field", "filegrid-video", id.toString(),
                "s3id", length, 16 * 1024 * 1024, offset, 0, null, null, Instant.now(), Instant.now());
    }
}
