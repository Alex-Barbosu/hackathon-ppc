import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InspectionHandle, Window } from "../../three/inspectionScene";
import { FINDINGS, FLIGHT } from "./findings";

/** Owns the rendered flight: loads three.js lazily, mirrors its clock into React a few times a second. */
export function useInspectionPlayer() {
  const gl = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const handle = useRef<InspectionHandle | null>(null);
  const [sec, setSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [windows, setWindows] = useState<Window[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const a = gl.current, b = overlay.current;
    if (!a || !b) return;
    let gone = false;
    void import("../../three/inspectionScene").then(({ mountInspection }) => {
      if (gone) return;
      try {
        handle.current = mountInspection(a, b, {
          findings: FINDINGS, duration: FLIGHT.durationSec, onWindows: setWindows,
          onTick: (s, p) => { setSec(s); setPlaying(p); },
        });
        // Reduced motion: start paused on the first finding instead of flying.
        if (reduced) { handle.current.pause(); handle.current.seek(8); }
      } catch { setFailed(true); }
    });
    return () => { gone = true; handle.current?.dispose(); handle.current = null; };
  }, [reduced]);

  const toggle = useCallback(() => { const h = handle.current; if (!h) return; if (playing) h.pause(); else h.play(); }, [playing]);
  const seek = useCallback((s: number) => handle.current?.seek(s), []);
  const focus = useCallback((id: string) => {
    const w = windows.find((x) => x.id === id);
    setSelected(id);
    handle.current?.select(id);
    // Land on the frame where the detection is clearest, and hold it.
    if (w) { handle.current?.seek(w.best); handle.current?.pause(); }
  }, [windows]);

  return { gl, overlay, sec, playing, windows, failed, selected, toggle, seek, focus };
}
