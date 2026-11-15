import { useMotionValue, useReducedMotion, useSpring, type MotionValue } from "framer-motion";
import { useEffect } from "react";

/** Two springs that follow the pointer across the window, each in -1..1. Still when motion is reduced. */
export function usePointerTilt(): { x: MotionValue<number>; y: MotionValue<number> } {
  const reduce = useReducedMotion();
  const rawX = useMotionValue(0), rawY = useMotionValue(0);
  // Heavy and soft: the object should feel like it has mass, not like it is glued to the cursor.
  const x = useSpring(rawX, { stiffness: 50, damping: 16, mass: 1.2 });
  const y = useSpring(rawY, { stiffness: 50, damping: 16, mass: 1.2 });
  useEffect(() => {
    if (reduce) return;
    const move = (e: PointerEvent) => { rawX.set((e.clientX / window.innerWidth) * 2 - 1); rawY.set((e.clientY / window.innerHeight) * 2 - 1); };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [reduce, rawX, rawY]);
  return { x, y };
}
