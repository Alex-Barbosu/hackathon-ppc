import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Select } from "../../components/select/Select";
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
      <Select label="Corrupt a stored file" value={id} disabled={locked}
        options={[{ value: "", label: items.length ? "Pick a file from the Library" : "No files in the Library yet" },
          ...items.map((f) => ({ value: f.id, label: f.originalName ?? f.id.slice(0, 8), hint: `${f.category} · ${f.storage}` }))]}
        onChange={setId} />
      <ConfirmButton label="Corrupt file" confirmLabel="Confirm corrupt" disabled={locked || !id || act.isPending}
        onConfirm={() => act.mutate({ kind: "corrupt", fileId: id })} />
    </div>
  );
}
