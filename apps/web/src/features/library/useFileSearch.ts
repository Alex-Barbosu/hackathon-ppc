import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "../../api/client";
import type { Category, Region } from "../../lib/domain";

export interface Filters {
  category: Category | "";
  region: Region | "";
  q: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { category: "", region: "", q: "", from: "", to: "" };

interface FilterStore {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  clear: () => void;
}

export const useFilters = create<FilterStore>((set) => ({
  filters: EMPTY,
  set: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  clear: () => set({ filters: EMPTY }),
}));

// Date inputs give YYYY-MM-DD; the API wants date-time. "to" covers the whole day.
const startOfDay = (d: string) => (d ? `${d}T00:00:00Z` : undefined);
const endOfDay = (d: string) => (d ? `${d}T23:59:59Z` : undefined);

export function useFileSearch() {
  const filters = useFilters((s) => s.filters);
  return useQuery({
    queryKey: ["files", filters],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/api/v1/files", {
        signal,
        params: {
          query: {
            category: filters.category || undefined,
            region: filters.region || undefined,
            q: filters.q || undefined,
            from: startOfDay(filters.from),
            to: endOfDay(filters.to),
            size: 20,
          },
        },
      });
      if (!data) throw new Error("Search failed");
      return data;
    },
  });
}
