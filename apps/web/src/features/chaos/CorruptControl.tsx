import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { FIELD } from "../../components/ui";
import { ConfirmButton } from "./ConfirmButton";
import { useChaosAction } from "./useChaos";

export function CorruptControl({ locked }: { locked: boolean }) {
  const act = useChaosAction();
  const [id, setId] = useState("");
  const files = useQuery({
    queryKey: ["chaos-files"],
    enabled: !locked,
    queryFn: async () => (await api.GET("/api/v1/files", { params: { query: { size: 30 } } })).data,
  });
  const items = files.data?.items ?? [];
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="corrupt-file">Corrupt a stored file</label>
      <select id="corrupt-file" className={FIELD} value={id} disabled={locked} onChange={(e) => setId(e.target.value)}>
        <option value="">{items.length ? "Pick a file from the Library" : "No files in the Library yet"}</option>
        {items.map((f) => <option key={f.id} value={f.id}>{f.category} · {f.originalName ?? f.id.slice(0, 8)} · {f.storage}</option>)}
      </select>
      <ConfirmButton label="Corrupt file" confirmLabel="Confirm corrupt" disabled={locked || !id || act.isPending}
        onConfirm={() => act.mutate({ kind: "corrupt", fileId: id })} />
    </div>
  );
}
