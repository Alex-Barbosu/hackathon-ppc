// The pager (contracts/alerts.md "Paging"): wakes one on-call person only when a business guarantee is at risk.
// Two routes. platform: a data-loss alert that has kept firing past a hold time -> admin on-call.
// grid: a burst of outage records in one county -> that region's dispatch on-call.
import { randomBytes } from "node:crypto";
import { iso, num, str, type Db, type Row } from "./db.js";
import { publish, ackTopic, type Fetch, type NtfyConfig, type NtfyMessage } from "./ntfy.js";

/** Alerts whose guarantee is "never lose or corrupt data". Warnings and latency alerts stay on the feed only. */
export const PAGING_ALERTS = ["StorageDown", "IntegrityFailure", "MeterReadingLossRisk", "DocumentProtectionFailure"];
const REGIONS: Record<string, string> = { muntenia: "Muntenia", banat: "Banat", dobrogea: "Dobrogea" };
const MAX_ATTEMPTS = 5;

export type Route = "platform" | "grid";
export interface OnCallPage {
  id: string; route: Route; onCall: string; title: string; message: string; link?: string; alert?: string; region?: string; county?: string;
  createdAt: string; resolvedAt?: string; delivery: "sent" | "pending" | "failed" | "off"; ackedAt?: string; ackedBy?: string;
}

export interface PagerConfig { holdSec: number; gridThreshold: number; publicUrl: string; ntfy: NtfyConfig | null }
export interface PagerDeps { db: Db; cfg: PagerConfig; fetch?: Fetch; onPage?: (route: Route) => void; onAck?: (via: "web" | "phone") => void; log?: (m: string) => void }

export function pagerConfigFromEnv(env: NodeJS.ProcessEnv, ntfy: NtfyConfig | null): PagerConfig {
  const n = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { holdSec: n(env.PAGER_HOLD_SEC, 60), gridThreshold: Math.max(1, n(env.PAGER_GRID_THRESHOLD, 5)), publicUrl: (env.FILEGRID_PUBLIC_URL?.trim() || "https://localhost").replace(/\/+$/, ""), ntfy };
}

export const toPage = (r: Row): OnCallPage => ({
  id: String(r.id), route: r.route === "grid" ? "grid" : "platform", onCall: str(r.on_call), title: str(r.title), message: str(r.message),
  ...(r.link ? { link: str(r.link) } : {}), ...(r.alertname ? { alert: str(r.alertname) } : {}),
  ...(r.region ? { region: str(r.region) } : {}), ...(r.county ? { county: str(r.county) } : {}),
  createdAt: iso(r.created_at), ...(r.resolved_at ? { resolvedAt: iso(r.resolved_at) } : {}),
  delivery: r.delivery === "sent" || r.delivery === "failed" || r.delivery === "off" ? r.delivery : "pending",
  ...(r.acked_at ? { ackedAt: iso(r.acked_at), ackedBy: str(r.acked_by) } : {}),
});

/** What a role may see and acknowledge: admin owns the platform, dispatch owns the grid. */
export function routesFor(role: string): Route[] {
  return role === "admin" ? ["platform", "grid"] : role === "dispatch" ? ["grid"] : [];
}

const minutes = (fromIso: string) => Math.max(1, Math.round((Date.now() - new Date(fromIso).getTime()) / 60_000));

/** Platform page text: the alert's summary, then the narrator's two sentences (or the rule's description). */
export function platformText(a: Row): { title: string; message: string } {
  const ann = (a.annotations ?? {}) as Record<string, string>;
  const lines = [`${str(a.alertname)} firing for ${minutes(iso(a.starts_at))} min.`, a.narration ? str(a.narration) : ann.description ?? ""];
  return { title: (ann.summary || str(a.alertname)).slice(0, 120), message: lines.filter(Boolean).join("\n").slice(0, 600) };
}

/** Grid page text: counts and a station name only, never a file name or an uploader. */
export function gridText(b: Row, threshold: number): { title: string; message: string } {
  const region = REGIONS[str(b.region)] ?? str(b.region);
  return {
    title: `Outage burst in ${str(b.county)}`,
    message: [
      `${num(b.outages)} outage records from ${str(b.county)} (${region}) in the last 15 minutes; the page threshold is ${threshold}.`,
      b.last_station ? `Latest from station ${str(b.last_station)}.` : "",
      "Open the outage hotspots to see which stations are failing.",
    ].filter(Boolean).join("\n"),
  };
}

const INSERT = `
  INSERT INTO insights.pages (route, open_key, on_call, topic, title, message, link, alert_id, alertname, region, county, ack_token, delivery)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (open_key) WHERE open_key IS NOT NULL DO NOTHING
  RETURNING *`;

export class Pager {
  private busy = false;
  constructor(private readonly d: PagerDeps) {}

  /** One pass: open new pages, close finished ones, retry pushes that did not leave. Never overlaps itself. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.platform();
      await this.grid();
      await this.retry();
    } catch (e) {
      this.d.log?.(`pager tick failed: ${e instanceof Error ? e.message : "error"}`);
    } finally { this.busy = false; }
  }

  private async platform(): Promise<void> {
    // The hold time is measured from the alert's start, so an alert that resolves inside it never pages anyone.
    const { rows } = await this.d.db.query(
      `SELECT a.* FROM insights.alerts a
       WHERE a.status = 'firing' AND (a.alertname = ANY($1) OR a.labels->>'page' = 'true')
         AND a.starts_at <= now() - make_interval(secs => $2)
         AND NOT EXISTS (SELECT 1 FROM insights.pages p WHERE p.alert_id = a.id)
       ORDER BY a.starts_at LIMIT 10`, [PAGING_ALERTS, this.d.cfg.holdSec]);
    for (const a of rows) {
      const t = platformText(a);
      await this.open("platform", `alert:${num(a.id)}`, "Admin on-call", "admin", t, "/operations", { alertId: num(a.id), alertname: str(a.alertname) });
    }
    const done = await this.d.db.query(
      `UPDATE insights.pages p SET resolved_at = now(), open_key = NULL FROM insights.alerts a
       WHERE p.alert_id = a.id AND p.resolved_at IS NULL AND a.status = 'resolved' RETURNING p.*`);
    for (const p of done.rows) await this.followUp(p, `Resolved: ${str(p.title)}`, "The alert behind this page has cleared.");
  }

  private async grid(): Promise<void> {
    const { rows } = await this.d.db.query("SELECT county, region, outages, last_station FROM insights.v_outage_bursts");
    for (const b of rows.filter((r) => num(r.outages) >= this.d.cfg.gridThreshold && str(r.region) in REGIONS)) {
      const region = str(b.region);
      await this.open("grid", `grid:${str(b.county)}`, `Dispatch on-call, ${REGIONS[region]}`, `dispatch-${region}`, gridText(b, this.d.cfg.gridThreshold), "/insights", { region, county: str(b.county) });
    }
    // A burst ends when its county has had no outage record for 15 minutes, not when it dips under the
    // threshold: otherwise a storm hovering around 5 would page, clear and page again.
    const active = rows.map((r) => str(r.county));
    const done = await this.d.db.query(
      `UPDATE insights.pages SET resolved_at = now(), open_key = NULL
       WHERE route = 'grid' AND resolved_at IS NULL AND NOT (county = ANY($1)) RETURNING *`, [active]);
    for (const p of done.rows) await this.followUp(p, `Quiet again: ${str(p.county)}`, "No new outage records from this county for 15 minutes.");
  }

  private async open(route: Route, key: string, onCall: string, suffix: string, t: { title: string; message: string }, link: string,
    extra: { alertId?: number; alertname?: string; region?: string; county?: string }): Promise<void> {
    const topic = this.d.cfg.ntfy ? `${this.d.cfg.ntfy.topic}-${suffix}` : null;
    const { rows } = await this.d.db.query(INSERT, [route, key, onCall, topic, t.title, t.message, link, extra.alertId ?? null, extra.alertname ?? null,
      extra.region ?? null, extra.county ?? null, randomBytes(16).toString("hex"), topic ? "pending" : "off"]);
    const row = rows[0];
    if (!row) return; // already open: one page per thing at risk
    this.d.onPage?.(route);
    await this.deliver(row);
  }

  private async deliver(p: Row): Promise<void> {
    const ntfy = this.d.cfg.ntfy;
    if (!ntfy || !p.topic) return;
    const link = `${this.d.cfg.publicUrl}${str(p.link)}`;
    const msg: NtfyMessage = {
      topic: str(p.topic), title: str(p.title), message: str(p.message), priority: 5,
      tags: [p.route === "grid" ? "zap" : "rotating_light"], click: link,
      actions: [
        { action: "http", label: "Acknowledge", url: `${ntfy.url}/${ackTopic(ntfy)}`, method: "POST", body: `ack:${num(p.id)}:${str(p.ack_token)}`, clear: true },
        { action: "view", label: "Open FileGrid", url: link },
      ],
    };
    try {
      await publish(ntfy, msg, this.d.fetch);
      await this.d.db.query("UPDATE insights.pages SET delivery = 'sent', attempts = attempts + 1 WHERE id = $1", [p.id]);
    } catch {
      await this.d.db.query(`UPDATE insights.pages SET attempts = attempts + 1, delivery = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END WHERE id = $1`, [p.id]);
      this.d.log?.(`pager: push for page ${num(p.id)} did not leave; retrying`);
    }
  }

  private async retry(): Promise<void> {
    const { rows } = await this.d.db.query("SELECT * FROM insights.pages WHERE delivery = 'pending' AND created_at > now() - interval '30 minutes' ORDER BY id LIMIT 10");
    for (const p of rows) await this.deliver(p);
  }

  /** A quiet note on the same topic, so whoever was woken knows the page is handled or over. */
  private async followUp(p: Row, title: string, message: string): Promise<void> {
    const ntfy = this.d.cfg.ntfy;
    if (!ntfy || !p.topic || p.delivery !== "sent") return;
    await publish(ntfy, { topic: str(p.topic), title, message, priority: 2, tags: ["white_check_mark"] }, this.d.fetch).catch(() => undefined);
  }

  async list(role: string, limit = 30): Promise<OnCallPage[]> {
    const { rows } = await this.d.db.query("SELECT * FROM insights.pages WHERE route = ANY($1) ORDER BY created_at DESC, id DESC LIMIT $2", [routesFor(role), limit]);
    return rows.map(toPage);
  }

  /** From the web app. Null when the page does not exist or is not this role's to acknowledge. */
  async ackFromWeb(id: number, role: string, user: string): Promise<OnCallPage | null> {
    const { rows } = await this.d.db.query(
      `UPDATE insights.pages SET acked_at = now(), acked_by = $3 WHERE id = $1 AND route = ANY($2) AND acked_at IS NULL RETURNING *`, [id, routesFor(role), user.slice(0, 64)]);
    if (rows[0]) { this.d.onAck?.("web"); await this.followUp(rows[0], `Acknowledged by ${user.slice(0, 64)}`, str(rows[0].title)); return toPage(rows[0]); }
    // Already acknowledged: the first acknowledgement stands.
    const again = await this.d.db.query("SELECT * FROM insights.pages WHERE id = $1 AND route = ANY($2)", [id, routesFor(role)]);
    return again.rows[0] ? toPage(again.rows[0]) : null;
  }

  /** From the phone, through ntfy. The one-time token is the proof; a wrong token changes nothing. */
  async ackFromPhone(id: number, token: string): Promise<void> {
    const { rows } = await this.d.db.query(
      "UPDATE insights.pages SET acked_at = now(), acked_by = 'phone' WHERE id = $1 AND ack_token = $2 AND acked_at IS NULL RETURNING *", [id, token]);
    if (rows[0]) { this.d.onAck?.("phone"); await this.followUp(rows[0], "Acknowledged from the phone", str(rows[0].title)); }
  }
}
