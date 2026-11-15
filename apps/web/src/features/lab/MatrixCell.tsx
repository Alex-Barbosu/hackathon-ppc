import { motion } from "framer-motion";
import { fmtMbps, fmtMs } from "./format";
import type { LabCell } from "../../lib/domain";
import { STORAGE_NAME } from "./constants";
import { errorText, rejectedByDesign } from "./errorText";

function Pill({ children, tone }: { children: string; tone: "accent" | "muted" }) {
  return (
    <span className={`text-[13px] ${tone === "accent" ? "text-ink" : "text-muted"}`}>
      {children}
    </span>
  );
}

function Body({ cell }: { cell: LabCell }) {
  if (cell.status === "pending") return <p className="text-sm text-muted">Waiting for its turn</p>;
  if (cell.errors > 0 && !cell.write) {
    const calm = rejectedByDesign(cell);
    return (
      <div>
        <p className={`text-sm font-medium ${calm ? "text-ink" : "text-bad"}`}>
          {calm ? "Not applicable" : `Failed: ${cell.errors} of ${cell.completed}`}
        </p>
        <ul className="mt-1 space-y-1 text-[13px] text-muted">
          {(cell.errorSamples.length ? [...new Set(cell.errorSamples)] : ["Storage refused the file"]).map((s) => <li key={s}>{errorText(s, cell)}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <dl className="space-y-1 text-sm tabular-nums">
      <div className="flex justify-between gap-2"><dt className="text-muted">Save, 95% within</dt><dd>{fmtMs(cell.write?.p95Ms)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-muted">Read, 95% within</dt><dd>{fmtMs(cell.read?.p95Ms)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-muted">Upload speed</dt><dd>{fmtMbps(cell.throughputMBps)}</dd></div>
      <div className="flex justify-between gap-2"><dt className="text-muted">Errors</dt><dd className={cell.errors ? "text-bad" : ""}>{cell.errors} of {cell.completed}</dd></div>
    </dl>
  );
}

export function MatrixCell({ cell, recommended, current }: { cell: LabCell; recommended: boolean; current: boolean }) {
  const running = cell.status === "running";
  return (
    <motion.div layout transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className={`rounded-widget border-[0.8px] p-4 ${recommended ? "border-white bg-accent-soft" : "border-line bg-panel"}`}>
      <div className="mb-3 flex min-h-6 flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium lg:hidden">{STORAGE_NAME[cell.storage]}</span>
        {recommended && <Pill tone="accent">Recommended</Pill>}
        {current && <Pill tone="muted">{recommended ? "· current policy" : "Current policy"}</Pill>}
      </div>
      <Body cell={cell} />
      {running && (
        <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={cell.samples} aria-valuenow={cell.completed} aria-label="Samples completed">
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <motion.div className="h-full bg-accent" animate={{ width: `${(cell.completed / cell.samples) * 100}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }} />
          </div>
          <p className="mt-1 text-[13px] text-muted tabular-nums">{cell.completed} of {cell.samples} samples</p>
        </div>
      )}
    </motion.div>
  );
}
