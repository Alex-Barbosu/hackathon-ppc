import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, authHeaders } from "../../api/client";
import type { Category, LabRun, Storage } from "./types";

const KEY = ["storage-lab", "latest"];

export function useLatestRun() {
  return useQuery<LabRun | null>({
    queryKey: KEY,
    // Fast while a run is live so cells fill in as they finish; slow otherwise.
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : 15000),
    queryFn: async ({ signal }) => {
      const res = await fetch("/insights/storage-lab/runs/latest", { signal, headers: authHeaders() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage Lab answered ${res.status}`);
      return (await res.json()) as LabRun;
    },
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (samplesPerCell: number): Promise<LabRun> => {
      const res = await fetch("/insights/storage-lab/runs", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ samplesPerCell }),
      });
      const body = (await res.json()) as LabRun & { message?: string };
      if (!res.ok) throw new Error(body.message ?? `Could not start (${res.status})`);
      return body;
    },
    onSuccess: (run) => qc.setQueryData(KEY, run),
  });
}

/** Primary storage per category from the live policy, to mark the current choice in the matrix. */
export function useCurrentPolicy() {
  return useQuery({
    queryKey: ["policy"],
    queryFn: async (): Promise<Partial<Record<Category, Storage>>> => {
      const { data } = await api.GET("/api/v1/policy");
      const c = data?.categories;
      if (!c) return {};
      return { meter: c.meter.primary, outage: c.outage.primary, document: c.document.primary, video: c.video.primary };
    },
  });
}
