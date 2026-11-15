import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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

/** Warms the Insights queries after sign-in, so opening the screen shows data instead of spinners. */
export function usePrefetchInsights(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    void client.prefetchQuery({ queryKey: ["briefing"], staleTime: 5 * 60_000, retry: false, queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/briefing", { signal });
      if (!data) throw new Error("Briefing unavailable");
      return data;
    } });
    void client.prefetchQuery({ queryKey: ["hotspots"], queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/outage-hotspots", { signal });
      if (!data) throw new Error("Hotspots unavailable");
      return data;
    } });
    void import("./map/MapCanvas");
  }, [enabled, client]);
}
