import { Stagger, StaggerItem } from "../../components/motion/Reveal";
import { motion, useReducedMotion } from "framer-motion";
import { Chip } from "../../components/ui";
import { Q } from "./prom";
import { usePromQuery } from "./usePromQuery";

const CATS = [
  { id: "meter", label: "Meter readings" },
  { id: "outage", label: "Outage records" },
  { id: "document", label: "Documents" },
  { id: "video", label: "Drone video" },
] as const;

function fmtMs(s: number | null | undefined): [string, string] {
  if (s == null) return ["–", ""];
  const ms = s * 1000;
  return ms >= 1000 ? [(ms / 1000).toFixed(2), "s"] : [ms.toFixed(ms < 10 ? 1 : 0), "ms"];
}
const fmtRate = (v: number | null | undefined) => (v == null ? "–" : v >= 10 ? v.toFixed(0) : v.toFixed(1));
const fmtPct = (v: number | null | undefined) => (v == null ? "0%" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

// Errors above 1% of operations put a category at risk; below that a retry absorbs them.
function status(rate: number | null | undefined, err: number | null | undefined) {
  if (err != null && err > 0.01) return <Chip tone="bad">Errors {fmtPct(err)}</Chip>;
  if (rate == null || rate === 0) return <Chip tone="neutral">Idle</Chip>;
  return <Chip tone="good">Healthy</Chip>;
}

function Big({ value, unit }: { value: string; unit: string }) {
  const reduce = useReducedMotion();
  // Key on the value: a short spring settles each change instead of a flash.
  return (
    <motion.p key={value} initial={reduce ? false : { opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }} className="font-display text-[48px] leading-none tabular-nums">
      {value}<span className="ml-1 font-sans text-base text-faint">{unit}</span>
    </motion.p>
  );
}

export function Tiles() {
  const p95 = usePromQuery(Q.p95);
  const rate = usePromQuery(Q.throughput);
  const err = usePromQuery(Q.errorRate);
  return (
    <Stagger as="section" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {CATS.map((c) => {
        const [v, u] = fmtMs(p95.data?.get(c.id));
        const r = rate.data?.get(c.id);
        const e = err.data?.get(c.id);
        return (
          <StaggerItem as="article" key={c.id} className="flex flex-col gap-6 rounded-card border-[0.8px] border-line bg-surface p-6 transition-colors duration-500 hover:border-white/16">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg tracking-[-0.2px]">{c.label}</h3>
              {status(r, e)}
            </div>
            <div>
              <p className="caption mb-2 text-muted">p95 latency</p>
              <Big value={v} unit={u} />
            </div>
            <dl className="grid grid-cols-2 border-t-[0.8px] border-line pt-4 text-sm tabular-nums">
              <div><dt className="caption text-muted">Throughput</dt><dd className="mt-1">{fmtRate(r)} ops/s</dd></div>
              <div><dt className="caption text-muted">Errors</dt><dd className={`mt-1 ${e != null && e > 0.01 ? "text-bad" : ""}`}>{fmtPct(e)}</dd></div>
            </dl>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
