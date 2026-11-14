import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export function useStoragesHealth() {
  return useQuery({
    queryKey: ["storages-health"],
    refetchInterval: 3000,
    // A failed poll must not blank the strip; keep the last known state until the next answer.
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/api/v1/storages/health", { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!data) throw new Error("Health unavailable");
      return data;
    },
  });
}
