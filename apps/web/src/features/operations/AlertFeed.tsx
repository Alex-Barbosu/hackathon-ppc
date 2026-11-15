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
    <section aria-label="Alerts">
      <p className="label text-faint">Alerts · last 15 minutes</p>
      {isError && <p className="mt-3 text-[13px] text-white/75">Alerts could not be read. Showing nothing rather than a stale list.</p>}
      {!isError && firing === 0 && <h3 className="mt-3 flex items-center gap-2.5 text-lg font-normal"><span aria-hidden className="size-2 rounded-full bg-good" />No alerts firing. Every guarantee is holding.</h3>}
      <ul className="mt-3 space-y-3">
        {shown.map((i) => {
          const live = i.status === "firing";
          return (
            <li key={i.id} className={`rounded-widget border-[0.8px] bg-black/30 p-4 ${live ? (i.severity === "critical" ? "border-bad/50" : "border-warn/50") : "border-white/12"}`}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-normal">{i.alert}</span>
                <span className={`rounded-md px-2 py-1 text-[13px] ${live ? (i.severity === "critical" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn") : "bg-good-soft text-good"}`}>
                  {live ? (i.severity === "critical" ? "Critical, firing" : "Warning, firing") : "Resolved"}
                </span>
                <span className="text-[13px] text-white/70 tabular-nums">since {formatDateTime(i.startedAt)}</span>
              </p>
              {i.summary && <p className="mt-1 text-[13px] text-white/70">{i.summary}</p>}
              {i.narration && <p className="mt-2 max-w-2xl text-base leading-6">{i.narration}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
