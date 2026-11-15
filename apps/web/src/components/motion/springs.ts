// One vocabulary of motion for the whole app, so nothing moves at its own speed.
// soft: content arriving. snappy: things the pointer drives. slow: large surfaces.
export const SPRING = {
  soft: { type: "spring", stiffness: 120, damping: 20, mass: 0.9 },
  snappy: { type: "spring", stiffness: 420, damping: 34 },
  slow: { type: "spring", stiffness: 60, damping: 18 },
} as const;

export const RISE = { hidden: { opacity: 0, y: 22, filter: "blur(6px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)" } } as const;
