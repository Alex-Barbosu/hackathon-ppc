import { useState } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { useSession } from "../../state/session";
import { useStartRun } from "./useLab";
import type { LabRun } from "./types";

export function RunBar({ run }: { run: LabRun | null | undefined }) {
  const admin = useSession((s) => s.session?.role === "admin");
  const start = useStartRun();
  const [n, setN] = useState(5);
  const running = run?.status === "running";
  const done = run ? run.cells.reduce((a, c) => a + c.completed, 0) : 0;
  const total = run ? run.cells.reduce((a, c) => a + c.samples, 0) : 0;
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="text-[13px] text-muted">
        Samples per cell
        <input type="number" min={1} max={200} value={n} disabled={!admin || running} onChange={(e) => setN(Number(e.target.value))}
          className={`${FIELD} mt-1 w-28 tabular-nums`} />
      </label>
      <PrimaryButton disabled={!admin || running || start.isPending || n < 1 || n > 200} onClick={() => start.mutate(n)}>
        {running ? "Benchmark running" : "Run benchmark"}
      </PrimaryButton>
      <p className="pb-2.5 text-[13px] text-muted tabular-nums" aria-live="polite">
        {!admin ? "Read-only. Running a benchmark needs the admin role." : running ? `${done} of ${total} samples` : run?.status === "failed" ? `Last run failed: ${run.error ?? "unknown error"}` : ""}
      </p>
      {start.error && <p role="alert" className="pb-2.5 text-[13px] text-bad">{start.error.message}</p>}
    </div>
  );
}
