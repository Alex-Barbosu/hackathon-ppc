import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ROMANIA_VIEWBOX } from "./countyCentres";
import { COUNTY_PATHS } from "./countyPaths";
import { MapDots } from "./MapDots";
import { SERVED, type MapDot } from "./model";

export type MapLayer = "outages" | "meters";
export interface MapCanvasProps { layer: MapLayer; dots: MapDot[]; active?: string | undefined; onHover: (county: string | null) => void; onSelect: (county: string) => void }

// Amber for outages, a cold blue for meter anomalies: switching layers must read as a different question at a glance.
const HOT: Record<MapLayer, readonly [number, number, number]> = { outages: [150, 92, 18], meters: [30, 96, 150] };

// Fills are opaque on purpose: the wide stroke drawn first is then covered everywhere except the country's
// outer edge, which gives Romania a crisp border and the counties hairlines, from one set of paths.
// Heat: a county's fill warms from the panel grey toward amber with its share of the busiest county's count.
// Square root, like the dots, so one very busy county does not flatten the rest to grey.
export function heatFill(name: string, heat: number, active: boolean, layer: MapLayer = "outages"): string {
  if (!SERVED.has(name)) return "#151515";
  const t = Math.sqrt(Math.max(0, Math.min(1, heat)));
  const [r, g, b] = HOT[layer];
  const mix = (a: number, z: number) => Math.round(a + (z - a) * t);
  const lift = active ? 14 : 0;
  return `rgb(${mix(29, r) + lift} ${mix(29, g) + lift} ${mix(29, b) + lift})`;
}

// Region names sit at the edge of each region, away from its dots; a dark halo keeps them clear of the borders.
const REGION_LABELS = [
  { text: "Banat", x: 18, y: 322 },
  { text: "Muntenia", x: 330, y: 430 },
  { text: "Dobrogea", x: 610, y: 430, end: true },
] as const;

export function MapCanvas({ layer, dots, active, onHover, onSelect }: MapCanvasProps) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const hasDot = new Set(dots.map((d) => d.county));
  const max = Math.max(1, ...dots.map((d) => d.count));
  const heat = new Map(dots.map((d) => [d.county, d.count / max]));
  return (
    <svg ref={ref} viewBox={ROMANIA_VIEWBOX} className="h-auto w-full overflow-visible select-none"
      role="group" aria-label={`Map of Romania: ${layer === "outages" ? "outage recordings" : "meters with anomalies"} by county`}>
      <motion.g aria-hidden initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0 }} transition={{ duration: 0.9 }}>
        <g fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth={2.6} strokeLinejoin="round">
          {COUNTY_PATHS.map((c) => <path key={c.name} d={c.d} />)}
        </g>
        <g strokeWidth={0.6} strokeLinejoin="round">
          {COUNTY_PATHS.map((c) => (
            <motion.path key={c.name} d={c.d} stroke={SERVED.has(c.name) ? "#3a3a3a" : "#262626"}
              initial={false} animate={{ fill: heatFill(c.name, seen ? (heat.get(c.name) ?? 0) : 0, c.name === active, layer) }} transition={{ duration: 0.8 }}
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
      <MapDots layer={layer} dots={dots} active={active} seen={seen} onHover={onHover} onSelect={onSelect} />
    </svg>
  );
}
