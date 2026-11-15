import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { components } from "../../api/schema";

export type OnCallPage = components["schemas"]["OnCallPage"];

/** Pages this role was given (the server filters: admin both routes, dispatch the grid only). */
export function usePages(enabled: boolean) {
  return useQuery({
    queryKey: ["pages"],
    enabled,
    refetchInterval: 5000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/pages", { signal });
      if (!data) throw new Error("Pages unavailable");
      return data;
    },
  });
}

export function useAckPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const { data } = await api.POST("/insights/pages/{pageId}/ack", { params: { path: { pageId } } });
      if (!data) throw new Error("Could not acknowledge");
      return data;
    },
    // Swap the one page in place so the button turns into "Acknowledged" without waiting for the next poll.
    onSuccess: (page) => qc.setQueryData<OnCallPage[]>(["pages"], (old) => old?.map((p) => (p.id === page.id ? page : p))),
  });
}
