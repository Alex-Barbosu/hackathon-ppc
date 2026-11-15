import { WIDGET } from "../../components/ui";
import { FLIGHT } from "./findings";
import { Scrubber } from "./Scrubber";
import { timecode } from "./timecode";
import type { useInspectionPlayer } from "./useInspectionPlayer";

type Player = ReturnType<typeof useInspectionPlayer>;

// Footage frame with the drone's own burnt-in readout, then the transport bar.
export function InspectionPlayer({ p }: { p: Player }) {
  return (
    <div className={WIDGET}>
      <div className="relative aspect-video bg-black tex-lines-sky">
        <canvas ref={p.gl} className="absolute inset-0 size-full [filter:saturate(0.82)_contrast(1.06)]" />
        <canvas ref={p.overlay} className="pointer-events-none absolute inset-0 size-full" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3 font-mono text-[11px] tabular-nums text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">
          <span>REC {timecode(p.sec)} · 4K 30 fps</span>
          <span className="hidden sm:inline">ALT 36 m AGL · GIMBAL −22°</span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden justify-between p-3 sm:flex font-mono text-[11px] text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">
          <span>{FLIGHT.line}</span>
          <span className="hidden sm:inline">{FLIGHT.model}</span>
        </div>
        {p.failed && <p role="alert" className="absolute inset-0 grid place-items-center bg-black/70 text-sm text-muted">This browser cannot play the inspection render (WebGL is off).</p>}
      </div>
      <Scrubber sec={p.sec} playing={p.playing} windows={p.windows} onToggle={p.toggle} onSeek={p.seek} onFocus={p.focus} />
    </div>
  );
}
