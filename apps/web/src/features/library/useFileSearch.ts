import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "../../api/client";
import { useAccess } from "../../state/useAccess";
import type { Category, County, Region } from "../../lib/domain";

export interface Filters {
  category: Category | "";
  region: Region | "";
  county: County | "";
  q: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { category: "", region: "", county: "", q: "", from: "", to: "" };

interface FilterStore {
  filters: Filters;
  page: number;
  setPage: (page: number) => void;
  set: (patch: Partial<Filters>) => void;
  clear: () => void;
}

export const useFilters = create<FilterStore>((set) => ({
  filters: EMPTY,
  page: 0,
  setPage: (page) => set({ page }),
  // A new filter starts from the first page; staying on page 7 of a smaller result would show nothing.
  set: (patch) => set((s) => ({ filters: { ...s.filters, ...patch }, page: 0 })),
  clear: () => set({ filters: EMPTY, page: 0 }),
}));

// Date inputs give YYYY-MM-DD; the API wants date-time. "to" covers the whole day.
const startOfDay = (d: string) => (d ? `${d}T00:00:00Z` : undefined);
const endOfDay = (d: string) => (d ? `${d}T23:59:59Z` : undefined);

export const PAGE_SIZE = 20;

/** The filters as sent: a role with one category (field, dispatch, connections) only ever searches that one. */
export function useScopedFilters(): Filters {
  const filters = useFilters((s) => s.filters);
  const { library } = useAccess();
  return library.length === 1 ? { ...filters, category: library[0]! } : filters;
}

export function searchQuery(filters: Filters, page: number, size: number) {
  return {
    category: filters.category || undefined,
    region: filters.region || undefined,
    county: filters.county || undefined,
    q: filters.q || undefined,
    from: startOfDay(filters.from),
    to: endOfDay(filters.to),
    page,
    size,
  };
}

export function useFileSearch() {
  const filters = useScopedFilters();
  const page = useFilters((s) => s.page);
  return useQuery({
    queryKey: ["files", filters, page],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/api/v1/files", { signal, params: { query: searchQuery(filters, page, PAGE_SIZE) } });
      if (!data) throw new Error("Search failed");
      return data;
    },
  });
}
