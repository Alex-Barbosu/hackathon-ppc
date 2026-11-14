import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export function useBriefing() {
  return useQuery({
    queryKey: ["briefing"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/briefing", { signal });
      if (!data) throw new Error("Briefing unavailable");
      return data;
    },
  });
}

export function useAnomalies(region: "muntenia" | "banat" | "dobrogea" | "") {
  return useQuery({
    queryKey: ["anomalies", region],
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/anomalies", { signal, params: { query: region ? { region } : {} } });
      if (!data) throw new Error("Anomalies unavailable");
      return data;
    },
  });
}

export function useHotspots() {
  return useQuery({
    queryKey: ["hotspots"],
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/outage-hotspots", { signal });
      if (!data) throw new Error("Hotspots unavailable");
      return data;
    },
  });
}
