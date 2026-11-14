import { useState } from "react";
import { FIELD } from "../../components/ui";
import { REGIONS } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";
import { useAnomalies } from "./useInsights";

const KIND: Record<string, string> = { consumption_drop: "Consumption drop", stuck_meter: "Stuck meter", voltage_sag: "Voltage sag", spike: "Spike" };
type Region = (typeof REGIONS)[number]["id"] | "";

export function AnomalyList() {
  const [region, setRegion] = useState<Region>("");
  const { data, isPending, isError } = useAnomalies(region);
  return (
    <section aria-label="Meter anomalies" className="overflow-hidden rounded-widget border-[0.8px] border-line bg-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="label text-faint">Meter anomalies</h3>
        <select aria-label="Region" className={`${FIELD} !w-auto`} value={region} onChange={(e) => setRegion(e.target.value as Region)}>
          <option value="">All regions</option>
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      {isPending && <div className="mt-4 h-24 animate-pulse rounded-xl bg-white/6" />}
      {isError && <p role="alert" className="mt-4 text-sm text-bad">Anomalies could not be read. Try again in a moment.</p>}
      {data?.length === 0 && <p className="mt-4 text-sm text-muted">No anomalies yet. They appear once parsed meter intervals are stored, because each reading is judged against the same time of day on that meter's other days.</p>}
      <ul className="mt-4 divide-y divide-line">
        {data?.slice(0, 8).map((a) => (
          <li key={`${a.meterId}-${a.kind}`} className="py-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-[13px]">{a.meterId}</span>
              <span className="rounded-md bg-warn-soft px-2 py-1 text-[13px] text-warn">{KIND[a.kind] ?? a.kind}</span>
              <span className="text-[13px] text-muted tabular-nums">{a.county ?? a.region ?? ""} · {formatDateTime(a.at)} · score {a.score}</span>
            </p>
            {a.explanation && <p className="mt-1 text-[13px] text-muted">{a.explanation}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
