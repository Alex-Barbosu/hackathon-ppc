import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";

/** Topics to subscribe the phone to. Admin only (the server refuses others): the topic name is the secret. */
export function usePagerSetup(enabled: boolean) {
  return useQuery({
    queryKey: ["pager-setup"],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await api.GET("/insights/pages/setup", { signal });
      if (!data) throw new Error("Pager setup unavailable");
      return data;
    },
  });
}

// A real COMTRADE configuration, so zone A reads a station and fault time and the hotspot view counts it.
function recording(i: number): File {
  const t = new Date(Date.now() - i * 40_000);
  const d = `${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}/${t.getUTCFullYear()}`;
  const h = t.toISOString().slice(11, 23);
  const cfg = [
    "Medgidia 110 kV,REL670 bay " + (i + 1) + ",2013", "2,1A,1D", "1,IA,A,,A,1,0,0,-32767,32767,1,1,P", "1,TRIP,,,0",
    "50", "1", "1000,100", `${d},${h}000`, `${d},${h}100`, "ASCII", "1", "",
  ].join("\r\n");
  return new File([cfg], `pager-demo-medgidia-${Date.now()}-${i + 1}.cfg`, { type: "text/plain" });
}

export const BURST = 5;

/** Uploads one burst of outage records from Constanța through the normal API, the way dispatch would. */
export function useOutageBurst() {
  const [sent, setSent] = useState(0);
  const m = useMutation({
    mutationFn: async () => {
      setSent(0);
      for (let i = 0; i < BURST; i++) {
        const file = recording(i);
        const { response } = await api.POST("/api/v1/files", {
          body: { category: "outage", region: "dobrogea", county: "Constanța", file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.set("category", "outage");
            form.set("region", "dobrogea");
            form.set("county", "Constanța");
            form.set("file", file);
            return form;
          },
        });
        if (!response.ok) throw new Error(`Upload ${i + 1} of ${BURST} was refused (${response.status})`);
        setSent(i + 1);
      }
    },
  });
  return { ...m, sent };
}
