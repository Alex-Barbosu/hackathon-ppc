import { formatDateTime } from "../../lib/format";
import type { Hotspot } from "../../lib/domain";
import { useHotspots } from "./useInsights";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HotspotList() {
  const { data, isPending, isError } = useHotspots();
  const max = Math.max(1, ...(data ?? []).map((h) => h.outages));
  const unrecorded = data?.some((h) => h.county === "Not recorded");
  return (
    <section aria-label="Outage hotspots" className="overflow-hidden rounded-widget border-[0.8px] border-line bg-panel p-6">
      <h3 className="label text-faint">Outage hotspots</h3>
      {isPending && <div className="mt-4 h-24 animate-pulse rounded-xl bg-white/6" />}
      {isError && <p role="alert" className="mt-4 text-sm text-bad">Hotspots could not be read. Try again in a moment.</p>}
      {data?.length === 0 && <p className="mt-4 text-sm text-muted">No outage records yet. Upload one on the Upload page and it is counted here.</p>}
      <ul className="mt-4 space-y-4">
        {data?.map((h) => <HotspotRow key={`${h.county}-${h.region}`} h={h} max={max} />)}
      </ul>
      {unrecorded && <p className="mt-4 text-[13px] text-muted">Some outage records were uploaded without a county, so they are counted by region.</p>}
    </section>
  );
}

function HotspotRow({ h, max }: { h: Hotspot; max: number }) {
  const stations = h.stations ?? [];
  return (
    <li>
      <p className="flex justify-between gap-3 text-sm">
        <span>{h.county === "Not recorded" ? "County not recorded" : h.county} <span className="text-muted">· {cap(h.region)}</span></span>
        <span className="tabular-nums">{h.outages} records</span>
      </p>
      <div className="mt-1 h-1.5 rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-chart" style={{ width: `${(h.outages / max) * 100}%` }} /></div>
      {stations.length > 0 && (
        <p className="mt-1.5 text-[13px] text-muted">
          {stations.slice(0, 3).map((s) => `${s.station.replace(/^Statia\s+/i, "")} (${s.outages})`).join(" · ")}
          {h.lastFaultAt && <> · last fault {formatDateTime(h.lastFaultAt)}</>}
        </p>
      )}
    </li>
  );
}
