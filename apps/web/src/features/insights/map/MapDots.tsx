import { motion } from "framer-motion";
import type { KeyboardEvent } from "react";
import { SPRING } from "../../../components/motion/springs";
import type { MapLayer } from "./MapCanvas";
import type { MapDot } from "./model";

interface Props { layer: MapLayer; dots: MapDot[]; active?: string | undefined; seen: boolean; onHover: (c: string | null) => void; onSelect: (c: string) => void }
// Names for the top three only; on a phone the map is too small for any, and the panel below names the county.
const LABELLED = 3;

// Pale dots on warm counties: the county fill carries the heat, the dot marks the exact count and is the click target.
export function MapDots({ layer, dots, active, seen, onHover, onSelect }: Props) {
  const current = dots.find((d) => d.county === active);
  const key = (county: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(county); }
  };
  return (
    <g>
      {/* Largest first, so a small county's dot is never hidden under a bigger neighbour's. */}
      {[...dots].reverse().map((d) => (
        <g key={`${layer}-${d.county}`} role="button" tabIndex={0} aria-pressed={d.county === active}
          aria-label={`${d.county}: ${d.count} ${layer === "outages" ? (d.count === 1 ? "outage recording" : "outage recordings") : (d.count === 1 ? "meter with anomalies" : "meters with anomalies")}`}
          className="cursor-pointer outline-none" onPointerEnter={() => onHover(d.county)} onPointerLeave={() => onHover(null)}
          onFocus={() => onSelect(d.county)} onClick={() => onSelect(d.county)} onKeyDown={key(d.county)}>
          <circle cx={d.x} cy={d.y} r={Math.max(d.r + 4, 11)} fill="transparent" />
          <motion.circle cx={d.x} cy={d.y} fill={layer === "outages" ? "#fde68a" : "#bae6fd"} fillOpacity={0.95} stroke="#121212" strokeWidth={1.4}
            initial={{ r: 0 }} animate={{ r: seen ? d.r : 0 }} transition={{ ...SPRING.soft, delay: seen ? 0.35 + d.rank * 0.08 : 0 }} />
        </g>
      ))}
      {current && (
        <motion.circle fill="none" stroke="#fafafa" strokeWidth={1.3} pointerEvents="none" initial={false}
          animate={{ cx: current.x, cy: current.y, r: current.r + 5, opacity: seen ? 1 : 0 }} transition={SPRING.snappy} />
      )}
      {dots.slice(0, LABELLED).map((d) => (
        <motion.text key={`${layer}-${d.county}`} x={d.x + d.r + 10} y={d.y + 3.5} fontSize={10.5} fill="rgb(255 255 255 / 0.88)"
          stroke="#121212" strokeWidth={3} paintOrder="stroke" pointerEvents="none" className="max-sm:hidden"
          initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0 }} transition={{ delay: seen ? 0.7 + d.rank * 0.08 : 0, duration: 0.5 }}>
          {d.county} <tspan fill="rgb(255 255 255 / 0.55)">{d.count}</tspan>
        </motion.text>
      ))}
    </g>
  );
}
