import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "../../../components/motion/springs";
import { Ticker } from "../../../components/motion/Ticker";
import { formatDateTime } from "../../../lib/format";
import type { MapDot } from "./model";

const KIND: Record<string, string> = { consumption_drop: "Consumption drop", stuck_meter: "Stuck meter", voltage_sag: "Voltage sag", spike: "Spike" };
const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The anomaly layer's side panel: which meters in this county to send a crew to, strongest first.
export function MeterDetail({ dot }: { dot: MapDot | undefined }) {
  if (!dot?.meters) return <p className="text-[15px] text-muted text-pretty">No meter anomalies yet.</p>;
  const meters = dot.meters;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={dot.county} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={SPRING.snappy}>
        <p className="caption text-muted">{cap(dot.region)}{dot.rank === 0 ? ", most flagged meters" : ""}</p>
        <h3 className="mt-2 font-display text-[40px] leading-none">{dot.county}</h3>
        <p className="mt-8 font-display text-[64px] leading-none"><Ticker value={dot.count} format={whole} /></p>
        <p className="mt-2 text-sm text-muted">{dot.count === 1 ? "meter" : "meters"} reading far from their own baseline</p>
        <ul className="mt-8 divide-y divide-line border-y border-line text-[13px]">
          {meters.slice(0, 5).map((m) => (
            <li key={m.meterId} className="flex items-baseline justify-between gap-3 py-2.5">
              <span className="whitespace-nowrap font-mono">{m.meterId}</span>
              <span className="text-right"><span className="block text-info">{KIND[m.kind] ?? m.kind}</span><span className="block text-muted tabular-nums">{formatDateTime(m.at)}</span></span>
            </li>
          ))}
        </ul>
      </motion.div>
    </AnimatePresence>
  );
}
