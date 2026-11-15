import type { ReactNode } from "react";
import { WIDGET } from "../../components/ui";
import { FLIGHT } from "./findings";
import { Scrubber } from "./Scrubber";
import { timecode } from "./timecode";
import type { PlayerState } from "./player";

// Footage frame with the drone's own burnt-in readout, then the transport bar.
export function InspectionPlayer({ p, children }: { p: PlayerState; children: ReactNode }) {
  return (
    <div className={WIDGET}>
      <div className="relative aspect-video bg-black tex-lines-sky">
        {children}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between bg-linear-to-b from-black/50 to-transparent p-3 pb-8 font-mono text-[11px] tabular-nums text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">
          <span>REC {timecode(p.sec)}</span>
          <span className="hidden sm:inline">ALT 36 m AGL · GIMBAL −22°</span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden justify-between bg-linear-to-t from-black/50 to-transparent p-3 pt-8 sm:flex font-mono text-[11px] text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">
          <span>{FLIGHT.line}</span>
          <span className="hidden sm:inline">{FLIGHT.model}</span>
        </div>
        {p.failed && <p role="alert" className="absolute inset-0 grid place-items-center bg-black/70 text-sm text-muted">This browser cannot play the inspection footage.</p>}
      </div>
      <Scrubber duration={p.duration} sec={p.sec} playing={p.playing} windows={p.windows} onToggle={p.toggle} onSeek={p.seek} onFocus={p.focus} />
    </div>
  );
}
