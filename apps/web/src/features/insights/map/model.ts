import { COUNTIES, type Anomaly, type Hotspot } from "../../../lib/domain.ts";
import { COUNTY_CENTRES } from "./countyCentres.ts";

/** One county on the map. `count` drives heat and dot size; `h` or `meters` carries the layer's detail. */
export interface MapDot { county: string; region: string; x: number; y: number; r: number; rank: number; count: number; h?: Hotspot; meters?: Anomaly[] }
export interface RegionShare { region: string; outages: number; share: number }
export interface MapModel { dots: MapDot[]; total: number; unplaced: number; regions: RegionShare[] }

const MIN_R = 3;
const MAX_R = 9;
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
    return c ? [{ county: h.county, region: h.region, x: c.x, y: c.y, r: dotRadius(h.outages, max), rank: 0, count: h.outages, h }] : [];
  }).map((d, rank) => ({ ...d, rank }));
  // Region totals include recordings without a county: they still happened in that region.
  const regions = SERVED_REGIONS.map((region) => {
    const outages = hotspots.filter((h) => h.region === region).reduce((n, h) => n + h.outages, 0);
    return { region, outages, share: total ? outages / total : 0 };
  }).sort((a, b) => b.outages - a.outages);
  return { dots, total, unplaced: total - dots.reduce((n, d) => n + d.count, 0), regions };
}

/**
 * The meter-anomaly layer: one dot per county, sized by how many distinct meters were flagged there.
 * Meters, not anomaly rows, because one faulty meter can fire many times and should not outweigh a county
 * where ten meters each misbehaved once.
 */
export function buildAnomalyModel(anomalies: readonly Anomaly[] = []): MapModel {
  const byCounty = new Map<string, { region: string; meters: Map<string, Anomaly> }>();
  for (const a of anomalies) {
    if (!a.county) continue;
    const g = byCounty.get(a.county) ?? { region: a.region ?? "", meters: new Map<string, Anomaly>() };
    // Keep each meter's strongest anomaly: that is the one an engineer would open first.
    const prev = g.meters.get(a.meterId);
    if (!prev || a.score > prev.score) g.meters.set(a.meterId, a);
    byCounty.set(a.county, g);
  }
  const ranked = [...byCounty].map(([county, g]) => ({ county, region: g.region, meters: [...g.meters.values()].sort((x, y) => y.score - x.score) }))
    .sort((a, b) => b.meters.length - a.meters.length || a.county.localeCompare(b.county));
  const max = ranked[0]?.meters.length ?? 0;
  const dots = ranked.flatMap((g) => {
    const c = CENTRE.get(g.county);
    return c ? [{ county: g.county, region: g.region, x: c.x, y: c.y, r: dotRadius(g.meters.length, max), rank: 0, count: g.meters.length, meters: g.meters }] : [];
  }).map((d, rank) => ({ ...d, rank }));
  const total = dots.reduce((n, d) => n + d.count, 0);
  const regions = SERVED_REGIONS.map((region) => {
    const n = dots.filter((d) => d.region === region).reduce((s, d) => s + d.count, 0);
    return { region, outages: n, share: total ? n / total : 0 };
  }).sort((a, b) => b.outages - a.outages);
  return { dots, total, unplaced: 0, regions };
}
