import { useHotspots } from "./useInsights";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HotspotList() {
  const { data, isPending, isError } = useHotspots();
  const max = Math.max(1, ...(data ?? []).map((h) => h.outages));
  const unrecorded = data?.some((h) => h.county === "Not recorded");
  return (
    <section aria-label="Outage hotspots" className="rounded-card border border-line bg-surface p-6">
      <h3 className="font-display text-lg">Outage hotspots</h3>
      {isPending && <div className="mt-4 h-24 animate-pulse rounded-xl bg-canvas" />}
      {isError && <p role="alert" className="mt-4 text-sm text-bad">Hotspots could not be read. Try again in a moment.</p>}
      {data?.length === 0 && <p className="mt-4 text-sm text-muted">No outage records yet. Upload one on the Upload page and it is counted here.</p>}
      <ul className="mt-4 space-y-3">
        {data?.map((h) => (
          <li key={`${h.county}-${h.region}`}>
            <p className="flex justify-between gap-3 text-sm">
              <span>{h.county === "Not recorded" ? "County not recorded" : h.county} <span className="text-muted">· {cap(h.region)}</span></span>
              <span className="tabular-nums">{h.outages} records</span>
            </p>
            <div className="mt-1 h-1.5 rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-accent" style={{ width: `${(h.outages / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
      {unrecorded && <p className="mt-4 text-[13px] text-muted">Outage uploads do not record a county yet, so records are counted by region.</p>}
    </section>
  );
}
