package ro.ppc.filegrid.files;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import org.junit.jupiter.api.Test;

class ComtradeCfgTest {

    /** A 1999 configuration: two analog and three digital channels, 4 kHz, 200 samples, trigger 250 ms after the start. */
    private static final String CFG_1999 = String.join("\r\n",
            "PLOIESTI NORD 110kV,DFR-7,1999",
            "5,2A,3D",
            "1,Va,A,,V,0.01,0,0,-32768,32767,110000,110,P",
            "2,Ia,A,,A,0.01,0,0,-32768,32767,1000,1,P",
            "1,TRIP,,,0",
            "2,CB_OPEN,,,0",
            "3,PROT,,,0",
            "50",
            "1",
            "4000,200",
            "14/11/2026,10:15:30.000000",
            "14/11/2026,10:15:30.250000",
            "ASCII",
            "1.0",
            "");

    private static Map<String, Object> parse(String text) {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        return ComtradeCfg.parse(b, b.length).orElseThrow();
    }

    @Test
    void readsTheStationTheFaultTimeAndTheLengthOfARecording() {
        Map<String, Object> m = parse(CFG_1999);

        assertThat(m).containsEntry("format", "comtrade")
                .containsEntry("station", "PLOIESTI NORD 110kV")
                .containsEntry("recorder", "DFR-7")
                .containsEntry("revision", "1999")
                .containsEntry("analogChannels", 2)
                .containsEntry("digitalChannels", 3)
                .containsEntry("lineHz", 50.0)
                .containsEntry("sampleRateHz", 4000.0)
                .containsEntry("samples", 200L)
                .containsEntry("recordingMs", 50L)
                .containsEntry("startTime", "2026-11-14T10:15:30Z")
                .containsEntry("faultTime", "2026-11-14T10:15:30.250Z")
                .containsEntry("dataFormat", "ASCII");
    }

    @Test
    void theJsonIsWhatTheViewsRead() {
        byte[] b = CFG_1999.getBytes(StandardCharsets.UTF_8);

        String json = ComtradeCfg.metadataJson(b, b.length).orElseThrow();

        assertThat(json).contains("\"station\":\"PLOIESTI NORD 110kV\"").contains("\"faultTime\":\"2026-11-14T10:15:30.250Z\"");
    }

    @Test
    void a1991FileHasNoYearOnTheFirstLine() {
        String cfg = CFG_1999.replace(",DFR-7,1999", ",DFR-7").replace("1.0\r\n", "");

        Map<String, Object> m = parse(cfg);

        assertThat(m).containsEntry("station", "PLOIESTI NORD 110kV").containsEntry("revision", "1991");
    }

    @Test
    void severalSampleRatesAddUp() {
        // 1 s at 1000 Hz, then 0.5 s at 2000 Hz: endsamp is the running count of samples.
        String cfg = CFG_1999.replace("1\r\n4000,200\r\n", "2\r\n1000,1000\r\n2000,2000\r\n");

        Map<String, Object> m = parse(cfg);

        assertThat(m).containsEntry("samples", 2000L).containsEntry("recordingMs", 1500L).containsEntry("sampleRateHz", 1000.0);
    }

    @Test
    void aVariableRateRecordingHasSamplesButNoLength() {
        String cfg = CFG_1999.replace("1\r\n4000,200\r\n", "0\r\n0,350\r\n");

        Map<String, Object> m = parse(cfg);

        assertThat(m).containsEntry("samples", 350L).doesNotContainKey("recordingMs")
                .containsEntry("faultTime", "2026-11-14T10:15:30.250Z");
    }

    @Test
    void aCffFileGivesItsConfigurationAndIgnoresTheDataSections() {
        String cff = "--- file type: CFG ---\r\n" + CFG_1999 + "--- file type: DAT ASCII: 3 ---\r\n1,0,1,2,3,4,5,6,7\r\n";

        Map<String, Object> m = parse(cff);

        assertThat(m).containsEntry("station", "PLOIESTI NORD 110kV").containsEntry("faultTime", "2026-11-14T10:15:30.250Z");
    }

    @Test
    void aHeadThatIsCutOffStillGivesWhatWasRead() {
        String cut = CFG_1999.substring(0, CFG_1999.indexOf("14/11/2026"));

        Map<String, Object> m = parse(cut);

        assertThat(m).containsEntry("station", "PLOIESTI NORD 110kV").doesNotContainKey("faultTime");
    }

    @Test
    void textIsCleanedAndStaysShort() {
        String cfg = CFG_1999.replace("PLOIESTI NORD 110kV", "ST\u0007ATION " + "x".repeat(300));

        Map<String, Object> m = parse(cfg);

        assertThat((String) m.get("station")).startsWith("ST ATION x").hasSize(128);
    }

    @Test
    void utf8AndLatin1NamesAreBothRead() {
        assertThat(parse(CFG_1999.replace("PLOIESTI NORD 110kV", "Ploiești Nord")).get("station")).isEqualTo("Ploiești Nord");

        byte[] latin1 = CFG_1999.replace("PLOIESTI NORD 110kV", "Timi\u00E7oara").getBytes(StandardCharsets.ISO_8859_1);
        assertThat(ComtradeCfg.parse(latin1, latin1.length).orElseThrow().get("station")).isEqualTo("Timi\u00E7oara");
    }

    @Test
    void aBadTimestampIsLeftOutNotFatal() {
        String cfg = CFG_1999.replace("14/11/2026,10:15:30.250000", "31/02/2026,10:15:30.250000");

        Map<String, Object> m = parse(cfg);

        assertThat(m).containsEntry("station", "PLOIESTI NORD 110kV").containsEntry("startTime", "2026-11-14T10:15:30Z")
                .doesNotContainKey("faultTime");
    }

    @Test
    void nanosecondTimestampsAreKept() {
        String cfg = CFG_1999.replace("10:15:30.250000", "10:15:30.123456789");

        assertThat(parse(cfg)).containsEntry("faultTime", "2026-11-14T10:15:30.123456789Z");
    }

    @Test
    void thingsThatAreNotAConfigurationGiveNothing() {
        assertThat(ComtradeCfg.parse(null, 0)).isEmpty();
        assertThat(ComtradeCfg.parse(new byte[0], 0)).isEmpty();
        assertThat(ComtradeCfg.parse("hello world".getBytes(StandardCharsets.UTF_8), 11)).isEmpty();
        assertThat(ComtradeCfg.parse("a,b\r\nnot,counts\r\n".getBytes(StandardCharsets.UTF_8), 17)).isEmpty();
        assertThat(ComtradeCfg.parse("a,b\r\n999999999,99999999A,0D\r\n".getBytes(StandardCharsets.UTF_8), 30)).isEmpty();
        byte[] noise = new byte[5000];
        new Random(1).nextBytes(noise);
        assertThat(ComtradeCfg.parse(noise, noise.length)).isEmpty();
        assertThat(ComtradeCfg.parse("x,y\r\n1,1A,0D\r\n".getBytes(StandardCharsets.UTF_8), 14)).as("channel lines missing").isEmpty();
    }

    @Test
    void randomBytesNeverThrow() {
        Random r = new Random(7);
        for (int i = 0; i < 300; i++) {
            byte[] b = new byte[r.nextInt(400)];
            r.nextBytes(b);
            Optional<Map<String, Object>> m = ComtradeCfg.parse(b, b.length);
            assertThat(m).isNotNull();
        }
    }

    @Test
    void onlyTheEndingOfTheNameDecides() {
        assertThat(ComtradeCfg.looksLikeConfig("fault.cfg")).isTrue();
        assertThat(ComtradeCfg.looksLikeConfig("FAULT.CFG")).isTrue();
        assertThat(ComtradeCfg.looksLikeConfig("record.cff")).isTrue();
        assertThat(ComtradeCfg.looksLikeConfig("fault.dat")).isFalse();
        assertThat(ComtradeCfg.looksLikeConfig("report.pdf")).isFalse();
        assertThat(ComtradeCfg.looksLikeConfig(null)).isFalse();
    }
}
