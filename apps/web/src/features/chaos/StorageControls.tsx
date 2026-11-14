import { SecondaryButton } from "../../components/ui";
import { ConfirmButton } from "./ConfirmButton";
import { useChaosAction, type ChaosState } from "./useChaos";

const STORAGES = [
  { id: "db", label: "PostgreSQL" },
  { id: "s3", label: "S3" },
  { id: "ftp", label: "FTPS" },
] as const;

export function StorageControls({ state, locked }: { state: ChaosState | undefined; locked: boolean }) {
  const act = useChaosAction();
  return (
    <ul className="space-y-2">
      {STORAGES.map((s) => {
        const stopped = state?.storages?.[s.id] === "stopped";
        return (
          <li key={s.id} className="flex items-center justify-between gap-3">
            <span className="text-sm">{s.label} <span className="text-[13px] text-muted">{stopped ? "stopped" : "running"}</span></span>
            {stopped ? (
              <SecondaryButton disabled={locked || act.isPending} onClick={() => act.mutate({ kind: "storage", storage: s.id, run: "start" })}>
                Start {s.label}
              </SecondaryButton>
            ) : (
              <ConfirmButton label={`Kill ${s.label}`} confirmLabel="Confirm kill" disabled={locked || act.isPending}
                onConfirm={() => act.mutate({ kind: "storage", storage: s.id, run: "stop" })} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
