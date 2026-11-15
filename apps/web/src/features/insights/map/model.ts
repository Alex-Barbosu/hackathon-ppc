import { COUNTIES, type Hotspot } from "../../../lib/domain.ts";
import { COUNTY_CENTRES } from "./countyCentres.ts";

export interface MapDot { county: string; region: string; x: number; y: number; r: number; rank: number; h: Hotspot }
export interface RegionShare { region: string; outages: number; share: number }
export interface MapModel { dots: MapDot[]; total: number; unplaced: number; regions: RegionShare[] }

const MIN_R = 4;
const MAX_R = 16;
const SERVED_REGIONS = ["dobrogea", "banat", "muntenia"] as const;
const CENTRE = new Map(COUNTY_CENTRES.map((c) => [c.name, c]));

/** The counties FileGrid serves; the rest of Romania is drawn only for context. */
export const SERVED = new Set<string>(COUNTIES.map((c) => c.id));

// Area, not radius, grows with the count: a county with four times the recordings looks four times as big, not sixteen.
export const dotRadius = (n: number, max: number) => MIN_R + (MAX_R - MIN_R) * Math.sqrt(n / Math.max(max, 1));

export function buildMapModel(hotspots: readonly Hotspot[] = []): MapModel {
  const total = hotspots.reduce((n, h) => n + h.outages, 0);
  const ranked = [...hotspots].filter((h) => h.outages > 0).sort((a, b) => b.outages - a.outages || a.county.localeCompare(b.county));
  const max = ranked[0]?.outages ?? 0;
  const dots = ranked.flatMap((h) => {
    const c = CENTRE.get(h.county);
    return c ? [{ county: h.county, region: h.region, x: c.x, y: c.y, r: dotRadius(h.outages, max), rank: 0, h }] : [];
  }).map((d, rank) => ({ ...d, rank }));
  // Region totals include recordings without a county: they still happened in that region.
  const regions = SERVED_REGIONS.map((region) => {
    const outages = hotspots.filter((h) => h.region === region).reduce((n, h) => n + h.outages, 0);
    return { region, outages, share: total ? outages / total : 0 };
  }).sort((a, b) => b.outages - a.outages);
  return { dots, total, unplaced: total - dots.reduce((n, d) => n + d.h.outages, 0), regions };
}
