import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Policy } from "../../lib/domain";
import { policyErrorText } from "./policyError";
import { rollbackBody } from "./policyHistory";
import { POLICY_KEY } from "./useLab";

const HISTORY_KEY = ["policy", "history"];

export function usePolicyHistory() {
  return useQuery({
    queryKey: HISTORY_KEY,
    refetchInterval: 10_000,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/api/v1/policy/history", { signal });
      if (!data) throw new Error("Policy history unavailable");
      return data;
    },
  });
}

// A rollback is a new version whose content is an old one: history stays append-only, so it is auditable.
export function useRollback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Policy) => {
      const res = await api.PUT("/api/v1/policy", { body: rollbackBody(p) });
      if (!res.data) throw new Error(policyErrorText((res.error as { code?: string } | undefined)?.code, res.response.status));
      return res.data;
    },
    onSuccess: (policy) => {
      qc.setQueryData(POLICY_KEY, policy);
      void qc.invalidateQueries({ queryKey: HISTORY_KEY });
      void qc.invalidateQueries({ queryKey: ["policy", "full"] });
    },
  });
}
