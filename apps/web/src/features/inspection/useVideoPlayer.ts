import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { drawBox } from "../../three/inspectionOverlay";
import { FINDINGS } from "./findings";
import { boxAt, type InspectionMedia } from "./media";
import type { PlayerState } from "./player";

/** Plays a supplied clip and draws the keyframed boxes over it with the same renderer as the 3D flight. */
export function useVideoPlayer(media: InspectionMedia) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [sec, setSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(1);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const tracks = useMemo(() => media.tracks ?? {}, [media]);
  const windows = useMemo(() => Object.entries(tracks).flatMap(([id, t]) => {
    const a = t[0], b = t[t.length - 1];
    if (!a || !b) return [];
    return [{ id, from: a[0], to: b[0], best: t[Math.floor(t.length / 2)]![0] }];
  }), [tracks]);
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const v = video.current, c = overlay.current;
    const ctx = c?.getContext("2d");
    if (!v || !c || !ctx) return;
    let frame = 0, lastTick = 0;
    const draw = (now: number) => {
      const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(window.devicePixelRatio, 2);
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const f of FINDINGS) {
        const b = tracks[f.id] && boxAt(tracks[f.id]!, v.currentTime);
        if (b) drawBox(ctx, f, { x: b[0] * w, y: b[1] * h, w: b[2] * w, h: b[3] * h }, v.currentTime, chosen.current === f.id);
      }
      if (now - lastTick > 100) { lastTick = now; setSec(v.currentTime); setPlaying(!v.paused); }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    const meta = () => setDuration(v.duration || 1);
    const fail = () => setFailed(true);
    v.addEventListener("loadedmetadata", meta);
    v.addEventListener("error", fail);
    return () => { cancelAnimationFrame(frame); v.removeEventListener("loadedmetadata", meta); v.removeEventListener("error", fail); };
  }, [tracks]);

  const toggle = useCallback(() => { const v = video.current; if (v) void (v.paused ? v.play() : v.pause()); }, []);
  const seek = useCallback((s: number) => { if (video.current) video.current.currentTime = s; }, []);
  const focus = useCallback((id: string) => {
    const w = windows.find((x) => x.id === id), v = video.current;
    setSelected(id);
    chosen.current = id;
    if (w && v) { v.pause(); v.currentTime = w.best; }
  }, [windows]);

  const state: PlayerState = { sec, playing, duration, windows, failed, selected, toggle, seek, focus };
  return { ...state, video, overlay };
}
