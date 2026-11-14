package ro.ppc.filegrid.tus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import ro.ppc.filegrid.common.ApiException;

class TusMetadataTest {

    private static String b64(String s) {
        return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void parsesKeysAndBase64Values() {
        var md = TusMetadata.parse("category " + b64("video") + ",filename " + b64("Pădure 1.mp4") + ",flag");

        assertThat(md).containsEntry("category", "video").containsEntry("filename", "Pădure 1.mp4")
                .containsEntry("flag", "");
    }

    @Test
    void anAbsentHeaderIsEmpty() {
        assertThat(TusMetadata.parse(null)).isEmpty();
        assertThat(TusMetadata.parse("  ")).isEmpty();
    }

    @Test
    void rejectsBadBase64DuplicateKeysAndEmptyKeys() {
        assertThatThrownBy(() -> TusMetadata.parse("category !!!")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> TusMetadata.parse("a " + b64("1") + ",a " + b64("2"))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> TusMetadata.parse(", ")).isInstanceOf(ApiException.class);
    }
}
