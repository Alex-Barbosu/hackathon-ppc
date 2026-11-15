import type { Window } from "../../three/inspectionScene";
import { FINDINGS } from "./findings";
import { timecode } from "./timecode";

const TONE = { high: "bg-bad", medium: "bg-warn", review: "bg-white/60" } as const;

interface ScrubberProps { duration: number; sec: number; playing: boolean; windows: Window[]; onToggle: () => void; onSeek: (s: number) => void; onFocus: (id: string) => void }

// Detection spans sit on the scrub track, so the operator jumps straight to what the model saw.
export function Scrubber({ duration, sec, playing, windows, onToggle, onSeek, onFocus }: ScrubberProps) {
  const pct = (s: number) => `${(s / duration) * 100}%`;
  return (
    <div className="flex items-center gap-4 border-t-[0.8px] border-line px-4 py-3">
      <button type="button" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-accent">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
          {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2 1l9 5-9 5z" />}
        </svg>
      </button>
      <div className="relative h-9 flex-1">
        {windows.map((w) => {
          const f = FINDINGS.find((x) => x.id === w.id);
          return f && (
            <button key={w.id} type="button" onClick={() => onFocus(w.id)} aria-label={`Jump to ${w.id}`}
              style={{ left: pct(w.from), width: `max(4px, ${pct(w.to - w.from)})` }}
              className={`absolute top-0 z-10 h-1.5 rounded-full ${TONE[f.severity]} opacity-80 hover:opacity-100`} />
          );
        })}
        <input type="range" min={0} max={duration} step={0.1} value={sec} aria-label="Flight position"
          onChange={(e) => onSeek(Number(e.target.value))} className="absolute inset-x-0 bottom-0 w-full" />
      </div>
      <span className="shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted">{timecode(sec)} / {timecode(duration)}</span>
    </div>
  );
}
