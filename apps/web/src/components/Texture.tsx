import type { ReactNode } from "react";

export type TextureName = "sky" | "field" | "amber" | "forest";

export const TEX_CLASS: Record<TextureName, string> = { sky: "tex-sky", field: "tex-field", amber: "tex-amber", forest: "tex-forest" };
// Dark glass tuned per texture so white text over it stays above 4.5:1.
const SCRIM: Record<TextureName, string> = {
  sky: "bg-[rgb(4_18_32/0.42)]",
  field: "bg-[rgb(6_16_4/0.45)]",
  amber: "bg-[rgb(0_0_0/0.34)]",
  forest: "bg-[rgb(0_0_0/0.36)]",
};

export function TexturePanel({ texture, className = "", children }: { texture: TextureName; className?: string; children?: ReactNode }) {
  return <section className={`relative overflow-hidden rounded-card ${TEX_CLASS[texture]} ${className}`}>{children}</section>;
}

// The dark card that sits on a texture and carries the words.
export function Scrim({ texture, className = "", children }: { texture: TextureName; className?: string; children: ReactNode }) {
  return <div className={`rounded-card border-[0.8px] border-white/16 ${SCRIM[texture]} ${className}`}>{children}</div>;
}
