import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";

export type TextureName = "sky" | "field" | "amber" | "forest" | "lines-sky" | "lines-dusk";

export const TEX_CLASS: Record<TextureName, string> = { sky: "tex-sky", field: "tex-field", amber: "tex-amber", forest: "tex-forest", "lines-sky": "tex-lines-sky", "lines-dusk": "tex-lines-dusk" };
// Dark glass tuned per texture so white text over it stays above 4.5:1.
const SCRIM: Record<TextureName, string> = {
  sky: "bg-[rgb(4_18_32/0.5)]",
  field: "bg-[rgb(6_16_4/0.55)]",
  amber: "bg-[rgb(0_0_0/0.4)]",
  forest: "bg-[rgb(0_0_0/0.45)]",
  "lines-sky": "bg-[rgb(4_14_26/0.62)]",
  "lines-dusk": "bg-[rgb(20_8_4/0.58)]",
};

// A landscape band. The picture is a little taller than its frame and drifts as the page scrolls,
// which gives the flat image the depth a window has.
export function TexturePanel({ texture, className = "", children }: { texture: TextureName; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-9%", "9%"]);
  return (
    <section ref={ref} className={`relative isolate overflow-hidden rounded-card ${className}`}>
      <motion.div aria-hidden style={reduce ? undefined : { y }} className={`absolute inset-x-0 -inset-y-[12%] -z-10 ${TEX_CLASS[texture]}`} />
      {children}
    </section>
  );
}

// The dark glass card that sits on a texture and carries the words.
export function Scrim({ texture, className = "", children }: { texture: TextureName; className?: string; children: ReactNode }) {
  return <div className={`rounded-card border-[0.8px] border-white/16 backdrop-blur-xl backdrop-saturate-150 ${SCRIM[texture]} ${className}`}>{children}</div>;
}
