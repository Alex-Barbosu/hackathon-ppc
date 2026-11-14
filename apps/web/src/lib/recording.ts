import type { ComtradeRecording } from "./domain";

// How sure FileGrid is about a COMTRADE fault time. An old recorder gives no time zone, and a dispatcher comparing
// it with a customer's call needs to know that the hour may be off, not discover it later.
export function clockNote(clock: ComtradeRecording["clock"]): string | null {
  if (clock === "assumed-utc") return "Recorder clock has no time zone; read as UTC";
  return null;
}

// "Statia 110/20kV Constanta Nord · fault 13 Nov 2026, 20:00" in the viewer's own time zone.
export function recordingLine(r: ComtradeRecording, format: (iso: string) => string): string | null {
  const parts = [r.station, r.faultTime ? `fault ${format(r.faultTime)}` : null].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}
