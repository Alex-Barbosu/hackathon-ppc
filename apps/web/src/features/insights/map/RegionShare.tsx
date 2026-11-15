import { motion } from "framer-motion";
import { SPRING } from "../../../components/motion/springs";
import type { RegionShare as Share } from "./model";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The decision-maker's one-line answer under the map: which region carries the outages.
export function RegionShare({ regions }: { regions: Share[] }) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:gap-8">
      {regions.map((r, i) => (
        <div key={r.region}>
          <p className="label text-faint">{cap(r.region)}</p>
          <p className="mt-2 font-display text-[32px] leading-none tabular-nums sm:text-[40px]">{Math.round(r.share * 100)}%</p>
          <div className="mt-3 h-1 rounded-full bg-line" aria-hidden>
            <motion.div className="h-full rounded-full bg-white/70" initial={{ width: 0 }} whileInView={{ width: `${r.share * 100}%` }}
              viewport={{ once: true }} transition={{ ...SPRING.slow, delay: 0.2 + i * 0.1 }} />
          </div>
          <p className="mt-2 text-[13px] text-muted">{r.outages} {r.outages === 1 ? "recording" : "recordings"}</p>
        </div>
      ))}
    </div>
  );
}
