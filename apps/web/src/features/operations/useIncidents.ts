import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export function useIncidents() {
  return useQuery({
    queryKey: ["incidents"],
    refetchInterval: 5000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/incidents", { signal });
      if (!data) throw new Error("Incidents unavailable");
      return data;
    },
  });
}
