import { formatDateTime } from "../../lib/format";
import { useIncidents } from "./useIncidents";

const RECENT_MS = 15 * 60_000;

export function AlertFeed() {
  const { data, isError } = useIncidents();
  const now = Date.now();
  // Firing first, then what resolved in the last 15 minutes; older history is not an operations concern.
  const shown = (data ?? [])
    .filter((i) => i.status === "firing" || now - new Date(i.startedAt).getTime() < RECENT_MS)
    .sort((a, b) => Number(b.status === "firing") - Number(a.status === "firing"))
    .slice(0, 5);
  const firing = shown.filter((i) => i.status === "firing").length;
  return (
    <section aria-label="Alerts" className="rounded-card border border-line bg-surface p-6">
      <h3 className="font-display text-lg">Alerts</h3>
      {isError && <p className="mt-3 text-[13px] text-muted">Alerts could not be read. Showing nothing rather than a stale list.</p>}
      {!isError && firing === 0 && <p className="mt-3 text-sm text-good">No alerts firing. The business guarantees are holding.</p>}
      <ul className="mt-3 space-y-3">
        {shown.map((i) => {
          const live = i.status === "firing";
          return (
            <li key={i.id} className={`rounded-xl border p-4 ${live ? (i.severity === "critical" ? "border-bad/50" : "border-warn/50") : "border-line"}`}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{i.alert}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${live ? (i.severity === "critical" ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn") : "bg-good/10 text-good"}`}>
                  {live ? (i.severity === "critical" ? "Critical, firing" : "Warning, firing") : "Resolved"}
                </span>
                <span className="text-[13px] text-muted tabular-nums">since {formatDateTime(i.startedAt)}</span>
              </p>
              {i.summary && <p className="mt-1 text-[13px] text-muted">{i.summary}</p>}
              {i.narration && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">{i.narration}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
