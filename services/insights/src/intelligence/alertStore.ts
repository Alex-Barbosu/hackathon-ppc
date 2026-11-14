import { iso, num, str, type Db, type Row } from "./db.js";

export interface ParsedAlert {
  fingerprint: string; alertname: string; status: "firing" | "resolved"; severity: string | null;
  labels: Record<string, string>; annotations: Record<string, string>; startsAt: string; endsAt: string | null;
}
export interface StoredAlert extends ParsedAlert { id: number; narration: string | null }

const cap = (o: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((o && typeof o === "object" ? o : {}) as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string").slice(0, 20).map(([k, v]) => [k.slice(0, 64), String(v).slice(0, 500)]),
  );

/** Alertmanager webhook v4 -> alerts we can store. Null when the body is not a usable webhook. */
export function parseWebhook(body: unknown): ParsedAlert[] | null {
  const alerts = (body as { alerts?: unknown })?.alerts;
  if (!Array.isArray(alerts) || alerts.length > 50) return null;
  const out: ParsedAlert[] = [];
  for (const raw of alerts as Array<Record<string, unknown>>) {
    const labels = cap(raw.labels);
    const startsAt = new Date(String(raw.startsAt));
    const status = raw.status === "resolved" ? "resolved" : raw.status === "firing" ? "firing" : null;
    if (!labels.alertname || labels.alertname.length > 64 || !status || Number.isNaN(startsAt.getTime())) return null;
    // Alertmanager sends 0001-01-01 as "no end yet".
    const ends = new Date(String(raw.endsAt));
    out.push({
      fingerprint: String(raw.fingerprint ?? `${labels.alertname}:${startsAt.toISOString()}`).slice(0, 64),
      alertname: labels.alertname, status, severity: labels.severity ?? null, labels, annotations: cap(raw.annotations),
      startsAt: startsAt.toISOString(), endsAt: status === "resolved" && !Number.isNaN(ends.getTime()) && ends.getFullYear() > 2000 ? ends.toISOString() : null,
    });
  }
  return out;
}

const UPSERT = `
  INSERT INTO insights.alerts (fingerprint, alertname, status, severity, labels, annotations, starts_at, ends_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (fingerprint, starts_at) DO UPDATE
    SET status = EXCLUDED.status, ends_at = EXCLUDED.ends_at, annotations = EXCLUDED.annotations, received_at = now()
  RETURNING id, (narration IS NULL AND status = 'firing' AND (narrated_at IS NULL OR narrated_at < now() - interval '5 minutes')) AS needs`;

/** Stores each alert once per (fingerprint, start). Returns the ids that still need a narration. */
export async function upsertAlerts(db: Db, alerts: ParsedAlert[]): Promise<number[]> {
  const need: number[] = [];
  for (const a of alerts) {
    const { rows } = await db.query(UPSERT, [a.fingerprint, a.alertname, a.status, a.severity, JSON.stringify(a.labels), JSON.stringify(a.annotations), a.startsAt, a.endsAt]);
    if (rows[0]?.needs === true) need.push(num(rows[0].id));
  }
  return need;
}

const toStored = (r: Row): StoredAlert => ({
  id: num(r.id), fingerprint: str(r.fingerprint), alertname: str(r.alertname), status: r.status === "resolved" ? "resolved" : "firing",
  severity: r.severity ? str(r.severity) : null, labels: (r.labels ?? {}) as Record<string, string>,
  annotations: (r.annotations ?? {}) as Record<string, string>, startsAt: iso(r.starts_at), endsAt: r.ends_at ? iso(r.ends_at) : null,
  narration: r.narration ? str(r.narration) : null,
});

export async function getAlert(db: Db, id: number): Promise<StoredAlert | null> {
  const { rows } = await db.query("SELECT * FROM insights.alerts WHERE id = $1", [id]);
  return rows[0] ? toStored(rows[0]) : null;
}

export async function saveNarration(db: Db, id: number, text: string, model: string): Promise<void> {
  await db.query("UPDATE insights.alerts SET narration=$2, narration_model=$3, narrated_at=now(), narration_error=NULL WHERE id=$1", [id, text, model]);
}

/** A short code, never the raw error text. */
export async function saveNarrationError(db: Db, id: number, code: string): Promise<void> {
  await db.query("UPDATE insights.alerts SET narrated_at=now(), narration_error=$2 WHERE id=$1", [id, code]);
}

export interface Incident {
  id: string; alert: string; status: "firing" | "resolved"; startedAt: string; severity?: "warning" | "critical"; summary?: string; narration?: string;
}

export async function listIncidents(db: Db, limit = 50): Promise<Incident[]> {
  const { rows } = await db.query("SELECT * FROM insights.alerts ORDER BY starts_at DESC, id DESC LIMIT $1", [Math.min(limit, 100)]);
  return rows.map(toStored).map((a) => ({
    id: String(a.id), alert: a.alertname, status: a.status, startedAt: a.startsAt,
    ...(a.severity === "warning" || a.severity === "critical" ? { severity: a.severity } : {}),
    ...(a.annotations.summary ? { summary: a.annotations.summary } : {}),
    ...(a.narration ? { narration: a.narration } : {}),
  }));
}
