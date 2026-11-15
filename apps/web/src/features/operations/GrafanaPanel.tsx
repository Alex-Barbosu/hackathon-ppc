import { useState } from "react";
import { WIDGET } from "../../components/ui";
import { DASHBOARDS, dashboardUrl } from "../../lib/grafana";

// Grafana holds the full p50/p95/p99 history, logs and traces. Embedded here so nobody has to leave the
// console to check a dashboard; loaded only when opened, because four Grafana frames are heavy.
export function GrafanaPanel() {
  const [uid, setUid] = useState<string | null>(null);
  return (
    <section aria-label="Grafana" className={WIDGET}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="caption mr-2 text-muted">Grafana</p>
          {DASHBOARDS.map((d) => (
            <button key={d.uid} type="button" aria-pressed={uid === d.uid} onClick={() => setUid(uid === d.uid ? null : d.uid)}
              className={`label rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent ${uid === d.uid ? "bg-white text-black" : "bg-white/8 text-muted hover:text-ink"}`}>
              {d.label}
            </button>
          ))}
        </div>
        <a href={uid ? dashboardUrl(uid) : "/grafana/"} target="_blank" rel="noreferrer" className="label text-info hover:underline">Open in Grafana ↗</a>
      </header>
      {uid
        ? <iframe key={uid} title="Grafana dashboard" src={dashboardUrl(uid, true)} loading="lazy" className="h-[620px] w-full border-t-[0.8px] border-line bg-[#111217]" />
        : <p className="border-t-[0.8px] border-line px-5 py-3 text-[13px] text-muted">Pick a dashboard to preview it here.</p>}
    </section>
  );
}
