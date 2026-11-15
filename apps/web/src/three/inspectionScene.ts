import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { Finding } from "../features/inspection/findings";
import { anchorPoint, dronePose, trees } from "./inspectionFlight";
import { drawBox, type Box } from "./inspectionOverlay";
import { powerLine } from "./line";
import { MOODS, skyDome } from "./sky";

export interface Window { id: string; from: number; to: number; best: number }
export interface InspectionHandle { play(): void; pause(): void; seek(sec: number): void; select(id: string | null): void; dispose(): void }
interface Options { findings: Finding[]; duration: number; onTick: (sec: number, playing: boolean) => void; onWindows: (w: Window[]) => void }

const FOV = 52;

// Projects an anchor to a screen box, or null when it is behind the drone, off frame or too far to detect.
function project(cam: PerspectiveCamera, at: Vector3, radius: number, w: number, h: number): Box | null {
  const dist = cam.position.distanceTo(at);
  if (dist > 125 || dist < 6) return null;
  const ndc = at.clone().project(cam);
  if (ndc.z > 1 || Math.abs(ndc.x) > 0.92 || Math.abs(ndc.y) > 0.9) return null;
  const r = (radius / (dist * Math.tan((FOV * Math.PI) / 360))) * (h / 2);
  // Smaller than about 1% of the frame height, a detector would not resolve it.
  if (r < h * 0.011) return null;
  return { x: (ndc.x + 1) * (w / 2), y: (1 - ndc.y) * (h / 2), r, dist };
}

/** Mounts the rendered inspection flight with detection overlays drawn on a 2D canvas above it. */
export function mountInspection(gl: HTMLCanvasElement, overlay: HTMLCanvasElement, o: Options): InspectionHandle {
  const renderer = new WebGLRenderer({ canvas: gl, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const mood = MOODS.day;
  const scene = new Scene();
  const { group, fog } = powerLine(mood);
  scene.fog = fog;
  scene.add(skyDome(mood), group, trees(o.findings, "#0b2416"));
  const cam = new PerspectiveCamera(FOV, 16 / 9, 0.5, 2000);
  const anchors = o.findings.map((f) => ({ f, at: anchorPoint(f.anchor) }));
  const ctx = overlay.getContext("2d")!;

  // The detection timeline, computed once by flying the path without rendering.
  const windows: Window[] = [];
  for (const { f, at } of anchors) {
    let from = -1, to = -1, best = -1, bestScore = Infinity;
    for (let s = 0; s <= o.duration; s += 0.2) {
      dronePose(s, o.duration, cam);
      cam.updateMatrixWorld();
      const box = project(cam, at, f.anchor.radius, 1600, 900);
      if (!box) continue;
      if (from < 0) from = s;
      to = s;
      // The "best frame": the whole box and its label inside the frame, at a comfortable reading size.
      const inside = box.x - box.r * 1.6 > 60 && box.x + box.r * 1.6 < 1540 && box.y - box.r - 30 > 40 && box.y + box.r < 860;
      if (inside && Math.abs(box.r - 70) < bestScore) { bestScore = Math.abs(box.r - 70); best = s; }
    }
    if (from >= 0) windows.push({ id: f.id, from, to, best: best >= 0 ? best : (from + to) / 2 });
  }
  o.onWindows(windows);

  let sec = 0, playing = true, last = performance.now(), frame = 0, lastTick = 0, selected: string | null = null;
  const draw = (now: number) => {
    if (playing) sec = (sec + Math.min(now - last, 100) / 1000) % o.duration;
    last = now;
    const w = gl.clientWidth, h = gl.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (overlay.width !== Math.round(w * dpr)) { renderer.setSize(w, h, false); overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    dronePose(sec, o.duration, cam);
    renderer.render(scene, cam);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const { f, at } of anchors) {
      const box = project(cam, at, f.anchor.radius, w, h);
      if (box) drawBox(ctx, f, box, sec, f.id === selected);
    }
    if (now - lastTick > 100) { lastTick = now; o.onTick(sec, playing); }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return {
    play: () => { playing = true; },
    pause: () => { playing = false; },
    seek: (s) => { sec = Math.min(Math.max(s, 0), o.duration - 0.01); },
    select: (id) => { selected = id; },
    dispose: () => {
      cancelAnimationFrame(frame);
      scene.traverse((x) => { const m = x as { geometry?: { dispose(): void }; material?: { dispose(): void } }; m.geometry?.dispose(); m.material?.dispose(); });
      renderer.dispose();
    },
  };
}
