import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

interface TickerProps { value: number | null | undefined; format: (n: number) => string; empty?: string }

// A number that rolls to its new value instead of jumping, so a change on a live screen is seen, not missed.
// The text is written straight to the DOM: a re-render per frame for every figure on Operations would be wasteful.
export function Ticker({ value, format, empty = "–" }: TickerProps) {
  const node = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value ?? 0);
  const reduce = useReducedMotion();
  const shown = useRef(false);

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    if (value == null) { el.textContent = empty; shown.current = false; return; }
    // The first real value counts up from zero; later ones roll from where they were.
    if (reduce) { el.textContent = format(value); return; }
    if (!shown.current) { mv.set(0); shown.current = true; }
    const controls = animate(mv, value, { type: "spring", stiffness: 70, damping: 20, onUpdate: (v) => { el.textContent = format(v); } });
    return () => controls.stop();
  }, [value, format, empty, mv, reduce]);

  return <span ref={node} className="tabular-nums">{value == null ? empty : format(value)}</span>;
}
