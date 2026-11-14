import type { ComtradeRecording } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";
import { clockNote, recordingLine } from "../../lib/recording";

// What FileGrid read from an outage record's COMTRADE file: which station, when the fault was triggered.
export function RecordingLine({ recording }: { recording: ComtradeRecording | undefined }) {
  if (!recording) return null;
  const line = recordingLine(recording, formatDateTime);
  if (!line) return null;
  const note = clockNote(recording.clock);
  return (
    <p className="mt-1 text-[13px] text-ink/80">
      {line}
      {note && <span className="text-muted"> · {note}</span>}
    </p>
  );
}
