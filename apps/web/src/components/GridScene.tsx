import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface GridSceneProps { mood?: "day" | "dusk"; className?: string }

// The live 3D transmission line. Three.js loads in its own chunk after first paint; until the first
// frame (or if WebGL is missing) the matching still, rendered from this same scene, stays in place.
export function GridScene({ mood = "day", className = "" }: GridSceneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const still = useReducedMotion() ?? false;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let dispose: (() => void) | undefined;
    let gone = false;
    void import("../three/gridScene").then(({ mountGridScene }) => {
      if (gone) return;
      try { dispose = mountGridScene(el, { mood, still, onReady: () => setReady(true) }).dispose; }
      catch { /* No WebGL: the still image behind the canvas is the scene. */ }
    });
    return () => { gone = true; dispose?.(); };
  }, [mood, still]);

  return (
    <div aria-hidden className={`absolute inset-0 ${mood === "day" ? "tex-lines-sky" : "tex-lines-dusk"} ${className}`}>
      <canvas ref={canvas} className={`size-full transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
