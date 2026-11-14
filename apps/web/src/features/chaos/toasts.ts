import { create } from "zustand";

interface Toast { id: number; text: string }
interface ToastStore { items: Toast[]; push: (text: string) => void; dismiss: (id: number) => void }

let next = 1;
export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (text) => {
    const id = next++;
    set((s) => ({ items: [...s.items, { id, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));
