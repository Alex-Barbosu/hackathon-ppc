import { create } from "zustand";
import { COUNTIES, type County, type Region, type UploadCategory } from "../../lib/domain";

interface UploadForm {
  category: UploadCategory;
  region: Region;
  county: County | null;
  file: File | null;
  setCategory: (category: UploadCategory) => void;
  setRegion: (region: Region) => void;
  setCounty: (county: County | null) => void;
  setFile: (file: File | null) => void;
}

// UI-only state, so it survives switching tabs without touching the server cache.
export const useUploadForm = create<UploadForm>((set) => ({
  category: "outage",
  region: "muntenia",
  county: null,
  file: null,
  setCategory: (category) => set({ category, file: null }),
  // The API refuses a county outside its region, so a region change drops a county that no longer fits.
  setRegion: (region) => set((s) => ({ region, county: COUNTIES.some((c) => c.id === s.county && c.region === region) ? s.county : null })),
  setCounty: (county) => set({ county }),
  setFile: (file) => set({ file }),
}));
