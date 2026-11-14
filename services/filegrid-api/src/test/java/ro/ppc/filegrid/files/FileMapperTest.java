package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class FileMapperTest {

    @Test
    void theRecordingIsTheContractsComtradeFieldsOnly() {
        String json = "{\"format\":\"comtrade\",\"station\":\"TIMISOARA SUD 110kV\",\"faultTime\":\"2026-07-14T10:15:30.250Z\","
                + "\"clock\":\"offset\",\"analogChannels\":2,\"timeCode\":\"+3\"}";

        assertThat(FileMapper.recording(json))
                .containsEntry("station", "TIMISOARA SUD 110kV")
                .containsEntry("faultTime", "2026-07-14T10:15:30.250Z")
                .containsEntry("clock", "offset")
                .doesNotContainKeys("analogChannels", "timeCode");
    }

    @Test
    void noRecordingForOtherOrMissingMetadata() {
        assertThat(FileMapper.recording(null)).isNull();
        assertThat(FileMapper.recording("{}")).isNull();
        assertThat(FileMapper.recording("not json")).isNull();
    }
}
