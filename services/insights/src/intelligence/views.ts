import { scrub } from "./privacy.js";
import { iso, num, str, type Db, type Row } from "./db.js";

export type AnomalyKind = "consumption_drop" | "stuck_meter" | "voltage_sag" | "spike";
export interface Anomaly {
  meterId: string; region?: string; county?: string; kind: AnomalyKind; score: number; at: string; explanation: string;
}
export interface HotspotStation { station: string; outages: number; lastFaultAt?: string }
export interface Hotspot {
  county: string; region: string; lat?: number; lon?: number; outages: number; totalMinutes: number;
  lastFaultAt?: string; stations: HotspotStation[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A plain sentence built from the view's own numbers; no model call, so it costs nothing and cannot drift. */
export function explainAnomaly(kind: AnomalyKind, row: { kwh: number; baseline: number; voltage: number; score: number }): string {
  switch (kind) {
    case "consumption_drop":
      return `Used ${r2(row.kwh)} kWh where this meter usually uses ${r2(row.baseline)} kWh at this time of day (${r1(row.score)} standard deviations below). A drop like this can mean an outage on site or tampering.`;
    case "spike":
      return `Used ${r2(row.kwh)} kWh where this meter usually uses ${r2(row.baseline)} kWh at this time of day (${r1(row.score)} standard deviations above).`;
    case "stuck_meter":
      return `Reported the same ${r2(row.kwh)} kWh for eight readings in a row, which a working meter rarely does.`;
    case "voltage_sag":
      return `Voltage fell to ${r1(row.voltage)} V, below the 207 V limit (230 V minus 10%).`;
  }
}

const KINDS: readonly string[] = ["consumption_drop", "stuck_meter", "voltage_sag", "spike"];

// One row per meter and kind (a stuck run produces many candidate rows), strongest first.
const ANOMALY_SQL = `
  SELECT * FROM (
    SELECT DISTINCT ON (meter_id, kind) meter_id, region, county, kind, score::float8 AS score, at,
           kwh::float8 AS kwh, baseline_kwh::float8 AS baseline_kwh, voltage::float8 AS voltage
    FROM insights.v_meter_anomaly_candidates
    WHERE ($1::text IS NULL OR region = $1)
    ORDER BY meter_id, kind, score DESC, at DESC
  ) t ORDER BY score DESC, at DESC LIMIT $2`;

export async function listAnomalies(db: Db, region?: string, limit = 50): Promise<Anomaly[]> {
  const { rows } = await db.query(ANOMALY_SQL, [region ?? null, Math.min(limit, 100)]);
  return rows.flatMap((r: Row) => {
    const kind = str(r.kind);
    if (!KINDS.includes(kind)) return [];
    const k = kind as AnomalyKind;
    return [{
      meterId: str(r.meter_id), ...(r.region ? { region: str(r.region) } : {}), ...(r.county ? { county: str(r.county) } : {}),
      kind: k, score: num(r.score), at: iso(r.at),
      explanation: explainAnomaly(k, { kwh: num(r.kwh), baseline: num(r.baseline_kwh), voltage: num(r.voltage), score: num(r.score) }),
    }];
  });
}

// pg returns jsonb already parsed; anything that is not a well-formed station row is dropped, not guessed at.
function stationsOf(v: unknown): HotspotStation[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x: unknown) => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    if (typeof o.station !== "string" || !o.station) return [];
    // A station name is read from an uploaded file's first line, so it is scrubbed like any text bound for the model.
    return [{ station: scrub(o.station).slice(0, 80), outages: num(o.outages), ...(o.last_fault_at ? { lastFaultAt: iso(new Date(str(o.last_fault_at))) } : {}) }];
  });
}

export async function listHotspots(db: Db, limit = 50): Promise<Hotspot[]> {
  const { rows } = await db.query(
    "SELECT county, region, lat, lon, outages, total_minutes::float8 AS total_minutes, last_fault_at, stations FROM insights.v_outage_by_county ORDER BY outages DESC LIMIT $1",
    [Math.min(limit, 100)],
  );
  return rows.map((r) => ({
    county: str(r.county), region: str(r.region), outages: num(r.outages), totalMinutes: num(r.total_minutes),
    ...(r.lat !== null && r.lat !== undefined ? { lat: num(r.lat), lon: num(r.lon) } : {}),
    ...(r.last_fault_at ? { lastFaultAt: iso(r.last_fault_at) } : {}),
    stations: stationsOf(r.stations),
  }));
}

export interface ViewFilters { region?: string | undefined; category?: string | undefined; storage?: string | undefined; days?: number | undefined; limit?: number | undefined }

/**
 * The analyst's window into the database: fixed queries over aggregate views, parameterised, capped.
 * There is no free SQL and no view that carries file names, contents or uploader names.
 */
export const VIEW_NAMES = ["files_daily", "meter_anomalies", "outage_hotspots", "alert_history"] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export async function queryView(db: Db, view: ViewName, f: ViewFilters = {}): Promise<Row[]> {
  const limit = Math.min(Math.max(f.limit ?? 20, 1), 50);
  const days = Math.min(Math.max(f.days ?? 7, 1), 60);
  switch (view) {
    case "files_daily":
      return (await db.query(
        `SELECT day::date AS day, category, storage, files::int AS files, bytes::float8 AS bytes FROM insights.v_files_daily
         WHERE day > now() - ($1 || ' days')::interval AND ($2::text IS NULL OR category = $2) AND ($3::text IS NULL OR storage = $3)
         ORDER BY day DESC, category LIMIT $4`, [String(days), f.category ?? null, f.storage ?? null, limit])).rows;
    case "meter_anomalies":
      return (await listAnomalies(db, f.region, limit)) as unknown as Row[];
    case "outage_hotspots":
      return (await listHotspots(db, limit)) as unknown as Row[];
    case "alert_history":
      return (await db.query(
        `SELECT alertname, severity, count(*)::int AS times, min(starts_at) AS first_seen, max(starts_at) AS last_seen,
                count(*) FILTER (WHERE status = 'firing')::int AS firing_now
         FROM insights.alerts WHERE starts_at > now() - ($1 || ' days')::interval GROUP BY 1, 2 ORDER BY times DESC LIMIT $2`,
        [String(days), limit])).rows;
  }
}
