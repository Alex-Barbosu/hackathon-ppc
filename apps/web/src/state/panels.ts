import { create } from "zustand";

export type PanelName = "chaos" | "analyst" | "demo";

interface Panels {
  open: PanelName | null;
  draft: string | null;
  show: (name: PanelName, draft?: string) => void;
  close: () => void;
}

// One side panel at a time: chaos and the analyst share the right edge, so opening one closes the other.
export const usePanels = create<Panels>((set) => ({
  open: null,
  draft: null,
  show: (open, draft) => set({ open, draft: draft ?? null }),
  close: () => set({ open: null, draft: null }),
}));
