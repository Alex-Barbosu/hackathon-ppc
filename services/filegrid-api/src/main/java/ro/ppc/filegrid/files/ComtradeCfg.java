package ro.ppc.filegrid.files;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the metadata of an outage file from a COMTRADE configuration (IEC 60255-24, IEEE C37.111): the station, the
 * recording device, when the fault was triggered and how long the recording runs. It is what lets the hotspot view
 * count outages per station and per day without anyone typing them in.
 *
 * <p>Only the {@code .cfg} text is read (or the CFG part at the top of a {@code .cff} file), and only its first
 * {@value #MAX_HEAD} bytes: the numeric samples in the {@code .dat} are never touched. Parsing is lenient and never
 * throws; a file that is not a COMTRADE configuration gives {@link Optional#empty()}, and the upload goes on as
 * it would without this.
 *
 * <p>Layout of a {@code .cfg} (a line each; the 1991 revision has no year, the 2013 one adds a few lines at the end):
 * <pre>
 * station_name,rec_dev_id,rev_year
 * TT,##A,##D                         (total, analog and digital channel counts)
 * ...one line per analog channel, then one per digital channel...
 * lf                                 (line frequency)
 * nrates
 * samp,endsamp                       (one line per rate)
 * dd/mm/yyyy,hh:mm:ss.ssssss         (first sample)
 * dd/mm/yyyy,hh:mm:ss.ssssss         (trigger: when the fault was detected)
 * ASCII | BINARY | BINARY32 | FLOAT32
 * timemult                           (1999 and 2013)
 * time_code,local_code               (2013 only: the recorder's offset from UTC, e.g. +2, -5h30, 0)
 * tmq_code,leapsec                   (2013 only)
 * </pre>
 * Times become UTC with the 2013 {@code time_code} when the file has one ({@code clock} = {@code offset}, or
 * {@code utc} for an offset of 0). Older files carry no zone at all, so the recorder's clock is read as UTC and
 * {@code clock} says {@code assumed-utc}, which the UI shows next to the time instead of hiding the guess.
 */
public final class ComtradeCfg {

    /** How much of the start of a file is looked at. A configuration is a few kilobytes; this is far more than enough. */
    public static final int MAX_HEAD = 256 * 1024;

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern TIMESTAMP = Pattern.compile(
            "^\\s*(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s*,\\s*(\\d{1,2}):(\\d{2}):(\\d{2})(?:[.,](\\d{1,9}))?\\s*$");
    private static final Pattern CFF_SECTION = Pattern.compile("(?im)^\\s*-{2,}\\s*file type:");
    private static final Pattern CHANNEL_COUNT = Pattern.compile("^\\s*(\\d+)\\s*,\\s*(\\d+)\\s*[aA]\\s*,\\s*(\\d+)\\s*[dD]\\s*$");
    private static final int MAX_TEXT = 128;
    // time_code per C37.111-2013 §6.4.17: an optional sign, hours, and optionally "h" then minutes ("-5h30").
    private static final Pattern TIME_CODE = Pattern.compile("^\\s*([+-]?)(\\d{1,2})(?:h(\\d{2}))?\\s*$");
    private static final int MAX_OFFSET_MINUTES = 14 * 60;

    private ComtradeCfg() {
    }

    /** True for a file name that may hold a COMTRADE configuration. The name is only looked at for its ending. */
    public static boolean looksLikeConfig(String originalName) {
        if (originalName == null) {
            return false;
        }
        String n = originalName.toLowerCase(Locale.ROOT);
        return n.endsWith(".cfg") || n.endsWith(".cff");
    }

    /**
     * The metadata as the JSON stored in {@code files.metadata}, or empty if the head is not a COMTRADE configuration.
     * The keys, all optional except {@code format}: {@code format} (always "comtrade"), {@code station},
     * {@code recorder}, {@code revision}, {@code analogChannels}, {@code digitalChannels}, {@code lineHz},
     * {@code sampleRateHz}, {@code samples}, {@code recordingMs}, {@code startTime}, {@code faultTime},
     * {@code clock} (with either time), {@code timeCode} (as written in the file), {@code dataFormat}.
     */
    public static Optional<String> metadataJson(byte[] head, int length) {
        return parse(head, length).map(m -> {
            try {
                return JSON.writeValueAsString(m);
            } catch (JsonProcessingException e) {
                return null;
            }
        });
    }

    static Optional<Map<String, Object>> parse(byte[] head, int length) {
        try {
            return doParse(head, length);
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private static Optional<Map<String, Object>> doParse(byte[] head, int length) {
        if (head == null || length <= 0) {
            return Optional.empty();
        }
        int n = Math.min(length, head.length);
        String text;
        try {
            // UTF-8 when the bytes are valid UTF-8 (a station called "Ploiești"), else Latin-1, as old recorders write.
            text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(head, 0, n)).toString();
        } catch (java.nio.charset.CharacterCodingException e) {
            text = new String(head, 0, n, StandardCharsets.ISO_8859_1);
        }
        text = text.replace("\uFEFF", "");
        // A .cff holds the sections one after the other, each under a "--- file type: ..." header, the configuration
        // first. Take the part under the first header, up to the next one.
        Matcher section = CFF_SECTION.matcher(text);
        if (section.find()) {
            int firstHeader = section.start();
            if (text.substring(0, firstHeader).isBlank()) {
                int begin = text.indexOf('\n', section.end());
                if (begin < 0) {
                    return Optional.empty();
                }
                int end = section.find() ? section.start() : text.length();
                text = text.substring(begin + 1, end);
            } else {
                text = text.substring(0, firstHeader);
            }
        }
        String[] lines = text.split("\\r?\\n");
        List<String> rows = new ArrayList<>();
        for (String l : lines) {
            rows.add(l);
        }
        if (rows.size() < 2) {
            return Optional.empty();
        }

        // Line 1: station_name,rec_dev_id[,rev_year]
        String[] first = rows.get(0).split(",", -1);
        if (first.length < 2) {
            return Optional.empty();
        }
        // Line 2: TT,##A,##D. Without it this is not a COMTRADE configuration.
        Matcher counts = CHANNEL_COUNT.matcher(rows.get(1));
        if (!counts.matches()) {
            return Optional.empty();
        }
        int analog = Integer.parseInt(counts.group(2));
        int digital = Integer.parseInt(counts.group(3));
        int next = 2 + analog + digital;
        if (next >= rows.size() || analog + digital > 100_000) {
            return Optional.empty();
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("format", "comtrade");
        putText(out, "station", first[0]);
        putText(out, "recorder", first[1]);
        out.put("revision", first.length > 2 && !first[2].isBlank() ? first[2].trim() : "1991");
        out.put("analogChannels", analog);
        out.put("digitalChannels", digital);

        Double lf = number(rows.get(next));
        if (lf != null) {
            out.put("lineHz", lf);
            next++;
        }
        Integer nrates = lf == null || next >= rows.size() ? null : integer(rows.get(next));
        if (nrates != null && nrates >= 0 && nrates <= 100) {
            next++;
            double seconds = 0;
            long samples = 0;
            double firstRate = 0;
            long previousEnd = 0;
            // nrates 0 means a variable rate: one line "0,endsamp" follows all the same.
            int rateLines = Math.max(1, nrates);
            for (int i = 0; i < rateLines && next < rows.size(); i++, next++) {
                String[] rate = rows.get(next).split(",");
                if (rate.length < 2) {
                    break;
                }
                double samp = Double.parseDouble(rate[0].trim());
                long end = Long.parseLong(rate[1].trim());
                if (i == 0) {
                    firstRate = samp;
                }
                if (end >= previousEnd) {
                    if (samp > 0) {
                        seconds += (end - previousEnd) / samp;
                    }
                    samples = end;
                    previousEnd = end;
                }
            }
            if (firstRate > 0) {
                out.put("sampleRateHz", firstRate);
            }
            if (samples > 0) {
                out.put("samples", samples);
            }
            if (seconds > 0) {
                out.put("recordingMs", Math.round(seconds * 1000));
            }
        }

        LocalDateTime start = null;
        LocalDateTime trigger = null;
        if (next + 1 < rows.size()) {
            start = timestamp(rows.get(next));
            trigger = timestamp(rows.get(next + 1));
            next += 2;
        }
        boolean formatRead = false;
        if (next < rows.size()) {
            String f = rows.get(next).trim().toUpperCase(Locale.ROOT);
            if (f.equals("ASCII") || f.equals("BINARY") || f.equals("BINARY32") || f.equals("FLOAT32")) {
                out.put("dataFormat", f);
                formatRead = true;
                next++;
            }
        }
        // time_code sits two lines after the data format (after timemult). Only looked for when the lines before it
        // were where they should be, so a stray number elsewhere is never taken for an offset.
        Integer offsetMinutes = null;
        if (formatRead && next + 1 < rows.size() && number(rows.get(next)) != null) {
            String timeCode = rows.get(next + 1).split(",", -1)[0];
            offsetMinutes = offsetMinutes(timeCode);
            if (offsetMinutes != null) {
                out.put("timeCode", timeCode.trim());
            }
        }
        if (start != null || trigger != null) {
            int shift = offsetMinutes == null ? 0 : offsetMinutes;
            if (start != null) {
                out.put("startTime", utc(start, shift));
            }
            if (trigger != null) {
                out.put("faultTime", utc(trigger, shift));
            }
            out.put("clock", offsetMinutes == null ? "assumed-utc" : offsetMinutes == 0 ? "utc" : "offset");
        }
        return Optional.of(out);
    }

    /** Adds a text value, cleaned: no control characters, trimmed, at most {@value #MAX_TEXT} characters; skipped if empty. */
    private static void putText(Map<String, Object> out, String key, String value) {
        String v = value == null ? "" : value.replaceAll("\\p{Cntrl}", " ").trim();
        if (v.length() > MAX_TEXT) {
            v = v.substring(0, MAX_TEXT);
        }
        if (!v.isEmpty()) {
            out.put(key, v);
        }
    }

    private static Double number(String s) {
        try {
            return Double.parseDouble(s.trim());
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Integer integer(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * A 2013 {@code time_code} ("+2", "-5h30", "0") in minutes, or null when it is not one. The standard defines it as
     * the offset of the file's times from UTC, so UTC = recorded time minus the offset.
     */
    static Integer offsetMinutes(String timeCode) {
        Matcher m = TIME_CODE.matcher(timeCode == null ? "" : timeCode);
        if (!m.matches()) {
            return null;
        }
        int minutes = Integer.parseInt(m.group(2)) * 60 + (m.group(3) == null ? 0 : Integer.parseInt(m.group(3)));
        if (minutes > MAX_OFFSET_MINUTES || (m.group(3) != null && Integer.parseInt(m.group(3)) >= 60)) {
            return null;
        }
        return "-".equals(m.group(1)) ? -minutes : minutes;
    }

    private static String utc(LocalDateTime recorded, int offsetMinutes) {
        return DateTimeFormatter.ISO_INSTANT.format(recorded.minusMinutes(offsetMinutes).toInstant(ZoneOffset.UTC));
    }

    /** {@code dd/mm/yyyy,hh:mm:ss.ssssss} as the recorder wrote it, with no zone yet, or null. */
    private static LocalDateTime timestamp(String line) {
        Matcher m = TIMESTAMP.matcher(line);
        if (!m.matches()) {
            return null;
        }
        try {
            LocalDate date = LocalDate.of(Integer.parseInt(m.group(3)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(1)));
            String frac = m.group(7) == null ? "" : m.group(7);
            int nanos = frac.isEmpty() ? 0 : Integer.parseInt((frac + "000000000").substring(0, 9));
            LocalTime time = LocalTime.of(Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)),
                    Integer.parseInt(m.group(6)), nanos);
            return LocalDateTime.of(date, time);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
