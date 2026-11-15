import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "../../../components/motion/springs";
import { Ticker } from "../../../components/motion/Ticker";
import { formatDateTime } from "../../../lib/format";
import type { MapDot } from "./model";

const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CountyDetail({ dot, total }: { dot: MapDot | undefined; total: number }) {
  if (!dot) {
    return <p className="text-[15px] text-muted text-pretty">No outage recordings with a county yet. Upload one as dispatch, pick its county, and it lands here.</p>;
  }
  const { h } = dot;
  const stations = h.stations ?? [];
  const top = Math.max(1, ...stations.map((s) => s.outages));
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={dot.county} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={SPRING.snappy}>
        <p className="label text-faint">{cap(dot.region)} · {dot.rank === 0 ? "Busiest county" : `No. ${dot.rank + 1}`}</p>
        <h3 className="mt-2 font-display text-[40px] leading-none">{dot.county}</h3>
        <p className="mt-8 font-display text-[64px] leading-none"><Ticker value={h.outages} format={whole} /></p>
        <p className="mt-2 text-sm text-muted">
          outage {h.outages === 1 ? "recording" : "recordings"}, {Math.round((h.outages / Math.max(total, 1)) * 100)}% of all
        </p>
        <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
          {h.lastFaultAt && <Row label="Last fault" value={formatDateTime(h.lastFaultAt)} />}
          {(h.totalMinutes ?? 0) > 0 && <Row label="Minutes without supply" value={whole(h.totalMinutes ?? 0)} />}
        </dl>
        {stations.length > 0 && (
          <div className="mt-8">
            <p className="label text-faint">Stations</p>
            <ul className="mt-3 space-y-3">
              {stations.slice(0, 4).map((s) => (
                <li key={s.station} className="text-[13px]">
                  <p className="flex justify-between gap-3"><span className="truncate">{s.station.replace(/^Statia\s+/i, "")}</span><span className="tabular-nums text-muted">{s.outages}</span></p>
                  <div className="mt-1.5 h-1 rounded-full bg-line" aria-hidden>
                    <motion.div className="h-full rounded-full bg-warn/80" initial={{ width: 0 }} animate={{ width: `${(s.outages / top) * 100}%` }} transition={SPRING.slow} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 py-3"><dt className="text-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}
