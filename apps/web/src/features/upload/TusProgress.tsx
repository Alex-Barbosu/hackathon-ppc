import { motion } from "framer-motion";
import { PrimaryButton, SecondaryButton } from "../../components/ui";
import { formatBytes } from "../../lib/format";
import type { TusState } from "./useTusUpload";

interface TusProgressProps {
  state: TusState;
  onToggle: () => void;
}

export function TusProgress({ state, onToggle }: TusProgressProps) {
  const paused = state.phase === "paused";
  const active = state.phase === "uploading" || paused || state.phase === "waiting";
  return (
    <div className="rounded-widget border-[0.8px] border-line bg-panel p-6" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-4xl tabular-nums">{state.percent}%</p>
        <p className="text-[13px] text-muted tabular-nums">
          {formatBytes(state.uploaded)} of {formatBytes(state.total)}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/12" role="progressbar" aria-valuenow={state.percent} aria-valuemin={0} aria-valuemax={100}>
        <motion.div
          className="h-full rounded-full bg-accent"
          animate={{ width: `${state.percent}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {active && <SecondaryButton onClick={onToggle}>{paused ? "Resume upload" : "Pause upload"}</SecondaryButton>}
        {state.phase === "waiting" && <p className="text-sm text-warn">{state.message}</p>}
        {state.phase === "failed" && <p className="text-sm text-bad">{state.message} Uploaded bytes are kept where the server confirmed them; press Resume to try again.</p>}
        {state.resumedAfterDisconnect && state.phase !== "waiting" && (
          <span className="rounded-md bg-accent-soft px-2 py-1 text-[13px] text-ink">Resumed after disconnect</span>
        )}
      </div>
      {state.phase === "failed" && <PrimaryButton className="mt-4" onClick={onToggle}>Resume upload</PrimaryButton>}
    </div>
  );
}
