import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { components } from "../../api/schema";
import { useSession } from "../../state/session";
import { useToasts } from "./toasts";

export type ChaosState = components["schemas"]["ChaosState"];
type Category = components["schemas"]["Category"];
type Storage = components["schemas"]["Storage"];
type Network = components["schemas"]["NetworkCondition"];

const KEY = ["chaos-state"];

export function useIsAdmin(): boolean {
  return useSession((s) => s.session?.role === "admin");
}

export function useChaosState() {
  const admin = useIsAdmin();
  return useQuery({
    queryKey: KEY,
    enabled: admin,
    refetchInterval: 4000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/chaos/state", { signal });
      if (!data) throw new Error("Chaos state unavailable");
      return data;
    },
  });
}

export type ChaosAction =
  | { kind: "storage"; storage: Storage; run: "stop" | "start" }
  | { kind: "network"; body: Network }
  | { kind: "storm"; category: Category; multiplier: number; durationSec: number }
  | { kind: "meters"; readingsPerSec: number }
  | { kind: "corrupt"; fileId: string }
  | { kind: "reset" };

async function send(a: ChaosAction): Promise<ChaosState> {
  const res =
    a.kind === "storage" ? await api.POST("/chaos/storages/{storage}/{action}", { params: { path: { storage: a.storage, action: a.run } } })
    : a.kind === "network" ? await api.POST("/chaos/network", { body: a.body })
    : a.kind === "storm" ? await api.POST("/chaos/storm", { body: a })
    : a.kind === "meters" ? await api.POST("/chaos/meters", { body: { readingsPerSec: a.readingsPerSec } })
    : a.kind === "corrupt" ? await api.POST("/chaos/corrupt", { body: { fileId: a.fileId } })
    : await api.POST("/chaos/reset");
  if (!res.data) {
    const msg = (res.error as { message?: string } | undefined)?.message;
    throw new Error(msg ?? `Request failed (${res.response.status})`);
  }
  return res.data;
}

export function useChaosAction() {
  const qc = useQueryClient();
  const toast = useToasts((s) => s.push);
  return useMutation({
    mutationFn: send,
    // Every action answers with the full state, so the timeline updates without a refetch.
    onSuccess: (state) => qc.setQueryData(KEY, state),
    onError: (e: Error) => toast(`Chaos action failed. ${e.message}`),
  });
}
