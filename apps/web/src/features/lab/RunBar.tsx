import { useState } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { useSession } from "../../state/session";
import { useStartRun } from "./useLab";
import type { LabRun } from "../../lib/domain";

export function RunBar({ run }: { run: LabRun | null | undefined }) {
  const admin = useSession((s) => s.session?.role === "admin");
  const start = useStartRun();
  const [n, setN] = useState(10);
  const running = run?.status === "running";
  const done = run ? (run.cells ?? []).reduce((a, c) => a + c.completed, 0) : 0;
  const total = run ? (run.cells ?? []).reduce((a, c) => a + c.samples, 0) : 0;
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="caption text-muted">
        Samples per cell
        <input type="number" min={1} max={200} value={n} disabled={!admin || running} onChange={(e) => setN(Number(e.target.value))}
          className={`${FIELD} mt-2 block w-28 tabular-nums`} />
      </label>
      <PrimaryButton disabled={!admin || running || start.isPending || n < 1 || n > 200} onClick={() => start.mutate(n)}>
        {running ? "Benchmark running" : "Run benchmark"}
      </PrimaryButton>
      <p className="pb-3.5 text-[13px] text-muted tabular-nums" aria-live="polite">
        {!admin ? "Running a benchmark needs the admin role." : running ? `${done} of ${total} samples` : run?.status === "failed" ? `Last run failed: ${run.error ?? "unknown error"}` : n < 10 ? "Fewer than 10 samples: the 95% figure is close to the single slowest upload. Use 10–20 for a fair result." : ""}
      </p>
      {start.error && <p role="alert" className="pb-3.5 text-[13px] text-bad">{start.error.message}</p>}
    </div>
  );
}
