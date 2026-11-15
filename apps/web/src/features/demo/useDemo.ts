import { create } from "zustand";
import { DEMO_STEPS } from "./steps";

interface Demo {
  /** Index of the step the presenter is on; the panel keeps it while closed. */
  at: number;
  done: ReadonlySet<number>;
  started: boolean;
  start: () => void;
  complete: (i: number) => void;
  goTo: (i: number) => void;
  stop: () => void;
}

export const useDemo = create<Demo>((set) => ({
  at: 0,
  done: new Set(),
  started: false,
  start: () => set({ started: true }),
  complete: (i) => set((s) => ({ done: new Set(s.done).add(i), at: Math.min(i + 1, DEMO_STEPS.length - 1) })),
  goTo: (at) => set({ at }),
  stop: () => set({ started: false, at: 0, done: new Set() }),
}));
