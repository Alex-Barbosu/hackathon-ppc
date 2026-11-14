import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { LabRecommendation, Policy } from "../../lib/domain";
import { policyErrorText } from "./policyError";
import { reviewPolicyChange, type PolicyReview } from "./policyGuard";
import { POLICY_KEY } from "./useLab";

type Failure = { error?: { code?: string }; response: Response };
// The contract lists only the 400 for PUT; 403, 401 and 503 also carry { code, message }.
const fail = (res: unknown): never => {
  const f = res as Failure;
  throw new Error(policyErrorText(f.error?.code, f.response.status));
};

export function useApplyPolicy(recs: readonly LabRecommendation[]) {
  const qc = useQueryClient();
  // Fresh GET on click: the preview must be built from what is in force now, not from a cached copy.
  const prepare = useMutation({
    mutationFn: async (): Promise<PolicyReview> => {
      const res = await api.GET("/api/v1/policy");
      return res.data ? reviewPolicyChange(res.data, recs) : fail(res);
    },
  });
  const apply = useMutation({
    mutationFn: async (next: Policy): Promise<Policy> => {
      const res = await api.PUT("/api/v1/policy", { body: next });
      return res.data ?? fail(res);
    },
    onSuccess: (policy) => {
      qc.setQueryData(POLICY_KEY, policy);
      prepare.reset();
    },
  });
  return { prepare, apply };
}
