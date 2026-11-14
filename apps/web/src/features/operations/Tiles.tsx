import { motion, useReducedMotion } from "framer-motion";
import { Q } from "./prom";
import { usePromQuery } from "./usePromQuery";

const CATS = [
  { id: "meter", label: "Meter readings" },
  { id: "outage", label: "Outage records" },
  { id: "document", label: "Documents" },
  { id: "video", label: "Drone video" },
] as const;

function fmtMs(s: number | null | undefined): string {
  if (s == null) return "–";
  const ms = s * 1000;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}
const fmtRate = (v: number | null | undefined) => (v == null ? "–" : v >= 10 ? v.toFixed(0) : v.toFixed(1));
const fmtPct = (v: number | null | undefined) => (v == null ? "0%" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

function Stat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: "bad" }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <dt className="label text-faint">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1">
        {/* Key on the value: a short spring settles each change instead of a flash. */}
        <motion.span
          key={value}
          initial={reduce ? false : { opacity: 0.4, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className={`font-display text-[32px] leading-none tabular-nums ${tone === "bad" ? "text-bad" : ""}`}
        >
          {value}
        </motion.span>
        <span className="text-[13px] text-muted">{unit}</span>
      </dd>
    </div>
  );
}

export function Tiles() {
  const p95 = usePromQuery(Q.p95);
  const rate = usePromQuery(Q.throughput);
  const err = usePromQuery(Q.errorRate);
  return (
    <section aria-label="Live metrics per category" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {CATS.map((c) => {
        const e = err.data?.get(c.id);
        return (
          <article key={c.id} className="rounded-card border border-line bg-surface p-6">
            <h3 className="text-xl tracking-[-0.2px]">{c.label}</h3>
            <dl className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
              <Stat label="p95 latency" value={fmtMs(p95.data?.get(c.id))} unit="" />
              <Stat label="Throughput" value={fmtRate(rate.data?.get(c.id))} unit="ops/s" />
              <Stat label="Errors" value={fmtPct(e)} unit="" tone={e != null && e > 0.01 ? "bad" : undefined} />
            </dl>
          </article>
        );
      })}
    </section>
  );
}
