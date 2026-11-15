import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ROMANIA_VIEWBOX } from "./countyCentres";
import { COUNTY_PATHS } from "./countyPaths";
import { MapDots } from "./MapDots";
import { SERVED, type MapDot } from "./model";

export interface MapCanvasProps { dots: MapDot[]; active?: string | undefined; onHover: (county: string | null) => void; onSelect: (county: string) => void }

// Fills are opaque on purpose: the wide stroke drawn first is then covered everywhere except the country's
// outer edge, which gives Romania a crisp border and the counties hairlines, from one set of paths.
const fillOf = (name: string, active: boolean) => (active ? "#2e2e2e" : SERVED.has(name) ? "#1d1d1d" : "#151515");

// Region names sit at the edge of each region, away from its dots; a dark halo keeps them clear of the borders.
const REGION_LABELS = [
  { text: "Banat", x: 18, y: 322 },
  { text: "Muntenia", x: 330, y: 430 },
  { text: "Dobrogea", x: 610, y: 430, end: true },
] as const;

export function MapCanvas({ dots, active, onHover, onSelect }: MapCanvasProps) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const hasDot = new Set(dots.map((d) => d.county));
  return (
    <svg ref={ref} viewBox={ROMANIA_VIEWBOX} className="h-auto w-full overflow-visible select-none"
      role="group" aria-label="Map of Romania: outage recordings by county">
      <motion.g aria-hidden initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0 }} transition={{ duration: 0.9 }}>
        <g fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth={2.6} strokeLinejoin="round">
          {COUNTY_PATHS.map((c) => <path key={c.name} d={c.d} />)}
        </g>
        <g strokeWidth={0.6} strokeLinejoin="round">
          {COUNTY_PATHS.map((c) => (
            <motion.path key={c.name} d={c.d} stroke={SERVED.has(c.name) ? "#3a3a3a" : "#262626"}
              initial={false} animate={{ fill: fillOf(c.name, c.name === active) }} transition={{ duration: 0.35 }}
              className={hasDot.has(c.name) ? "cursor-pointer" : undefined}
              onPointerEnter={hasDot.has(c.name) ? () => onHover(c.name) : undefined}
              onPointerLeave={hasDot.has(c.name) ? () => onHover(null) : undefined}
              onClick={hasDot.has(c.name) ? () => onSelect(c.name) : undefined} />
          ))}
        </g>
        {REGION_LABELS.map((l) => (
          <text key={l.text} x={l.x} y={l.y} textAnchor={"end" in l ? "end" : "start"} fill="rgb(255 255 255 / 0.42)"
            fontFamily="var(--font-mono)" fontSize={9} letterSpacing={1.6}
            stroke="#121212" strokeWidth={4} paintOrder="stroke" className="max-sm:hidden">{l.text.toUpperCase()}</text>
        ))}
      </motion.g>
      <MapDots dots={dots} active={active} seen={seen} onHover={onHover} onSelect={onSelect} />
    </svg>
  );
}
