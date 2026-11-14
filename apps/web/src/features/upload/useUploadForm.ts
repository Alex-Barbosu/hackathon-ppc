import { create } from "zustand";
import type { Region, UploadCategory } from "../../lib/domain";

interface UploadForm {
  category: UploadCategory;
  region: Region;
  file: File | null;
  setCategory: (category: UploadCategory) => void;
  setRegion: (region: Region) => void;
  setFile: (file: File | null) => void;
}

// UI-only state, so it survives switching tabs without touching the server cache.
export const useUploadForm = create<UploadForm>((set) => ({
  category: "outage",
  region: "muntenia",
  file: null,
  setCategory: (category) => set({ category, file: null }),
  setRegion: (region) => set({ region }),
  setFile: (file) => set({ file }),
}));
