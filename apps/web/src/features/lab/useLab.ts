import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Category, LabRun, Storage } from "../../lib/domain";

const KEY = ["storage-lab", "latest"];

export function useLatestRun() {
  return useQuery<LabRun | null>({
    queryKey: KEY,
    // Fast while a run is live so cells fill in as they finish; slow otherwise.
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : 15000),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/insights/storage-lab/runs/latest", { signal });
      if (response.status === 404) return null;
      if (!data) throw new Error(`Storage Lab answered ${response.status}`);
      return data;
    },
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (samplesPerCell: number): Promise<LabRun> => {
      const res = await api.POST("/insights/storage-lab/runs", { body: { samplesPerCell } });
      if (res.data) return res.data;
      // The contract lists only the 202; 403 and 409 also come back with { code, message }.
      const failed = res as unknown as { error?: { message?: string }; response: Response };
      throw new Error(failed.error?.message ?? `Could not start (${failed.response.status})`);
    },
    onSuccess: (run) => qc.setQueryData(KEY, run),
  });
}

export const POLICY_KEY = ["policy"];

/** The live policy. The matrix highlight and Apply both read it, so neither can drift from the server. */
export function usePolicy() {
  return useQuery({
    queryKey: POLICY_KEY,
    refetchInterval: 10000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/api/v1/policy", { signal });
      if (!data) throw new Error("Policy unavailable");
      return data;
    },
  });
}

/** Primary storage per category, to mark the current choice in the matrix. */
export function useCurrentPolicy() {
  return useQuery({
    queryKey: POLICY_KEY,
    queryFn: async () => (await api.GET("/api/v1/policy")).data,
    select: (p): Partial<Record<Category, Storage>> => {
      const c = p?.categories;
      return c ? { meter: c.meter.primary, outage: c.outage.primary, document: c.document.primary, video: c.video.primary } : {};
    },
  });
}
