import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { hill, powerLine } from "./line";
import { MOODS, skyDome } from "./sky";

export interface GridSceneHandle { dispose: () => void }
export interface GridSceneOptions { mood: "day" | "dusk"; still: boolean; onReady: () => void }

// Eye height is 2 m above the land at that spot, like someone standing in the field.
const EYE = new Vector3(-13, hill(-13, 44) + 1.2, 44);
const LOOK = new Vector3(3, 24, -30);

/** Mounts the live transmission-line scene on a canvas. Renders only while visible, at most 2x pixel ratio. */
export function mountGridScene(canvas: HTMLCanvasElement, { mood, still, onReady }: GridSceneOptions): GridSceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  const sky = skyDome(MOODS[mood]);
  const { group, fog } = powerLine(MOODS[mood]);
  scene.fog = fog;
  scene.add(sky, group);
  const camera = new PerspectiveCamera(46, 1, 0.5, 2000);
  const pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
  let visible = true, frame = 0, first = true;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement ?? canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // A tall panel would crop the towers; widen the lens instead.
    camera.fov = w / h < 1 ? 58 : 46;
    camera.updateProjectionMatrix();
  };
  const draw = (ms: number) => {
    const t = ms / 1000;
    eased.x += (pointer.x - eased.x) * 0.04;
    eased.y += (pointer.y - eased.y) * 0.04;
    // A slow dolly breathing in and out, plus a few metres of parallax from the pointer.
    camera.position.set(EYE.x + eased.x * 5 + Math.sin(t * 0.07) * 2.2, EYE.y - eased.y * 1.2 + Math.sin(t * 0.11) * 0.3, EYE.z + Math.cos(t * 0.05) * 3);
    camera.lookAt(LOOK.x + eased.x * 2, LOOK.y, LOOK.z);
    sky.material.uniforms.uTime!.value = t;
    renderer.render(scene, camera);
    if (first) { first = false; onReady(); }
  };
  const loop = (ms: number) => { draw(ms); if (visible && !still) frame = requestAnimationFrame(loop); };
  const move = (e: PointerEvent) => { pointer.x = (e.clientX / window.innerWidth) * 2 - 1; pointer.y = (e.clientY / window.innerHeight) * 2 - 1; };
  const sizes = new ResizeObserver(() => { resize(); if (still) draw(0); });
  const seen = new IntersectionObserver(([e]) => {
    const now = (e?.isIntersecting ?? true) && !document.hidden;
    if (now && !visible && !still) frame = requestAnimationFrame(loop);
    visible = now;
  });
  resize();
  sizes.observe(canvas.parentElement ?? canvas);
  seen.observe(canvas);
  window.addEventListener("pointermove", move, { passive: true });
  frame = requestAnimationFrame(loop);

  return {
    dispose: () => {
      cancelAnimationFrame(frame);
      sizes.disconnect(); seen.disconnect();
      window.removeEventListener("pointermove", move);
      scene.traverse((o) => { const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } }; m.geometry?.dispose(); m.material?.dispose(); });
      renderer.dispose();
    },
  };
}
