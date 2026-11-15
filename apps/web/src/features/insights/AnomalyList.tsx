import { useState } from "react";
import { Select } from "../../components/select/Select";
import { REGION_OPTIONS, withAll } from "../../lib/options";
import { ExportButton } from "../../components/ExportButton";
import type { Column } from "../../lib/csv";
import { REGIONS, type Anomaly } from "../../lib/domain";
import { formatDateTime } from "../../lib/format";
import { useAnomalies } from "./useInsights";

const KIND: Record<string, string> = { consumption_drop: "Consumption drop", stuck_meter: "Stuck meter", voltage_sag: "Voltage sag", spike: "Spike" };
const ANOMALY_COLUMNS: Column<Anomaly>[] = [
  { header: "Meter", value: (a) => a.meterId }, { header: "Kind", value: (a) => KIND[a.kind] ?? a.kind },
  { header: "Region", value: (a) => a.region }, { header: "County", value: (a) => a.county },
  { header: "At", value: (a) => a.at }, { header: "Score", value: (a) => a.score }, { header: "Explanation", value: (a) => a.explanation },
];
type Region = (typeof REGIONS)[number]["id"] | "";

export function AnomalyList() {
  const [region, setRegion] = useState<Region>("");
  const { data, isPending, isError } = useAnomalies(region);
  return (
    <section aria-label="Meter anomalies" className="overflow-hidden rounded-widget border-[0.8px] border-line bg-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ExportButton name="meter-anomalies" rows={data} columns={ANOMALY_COLUMNS} />
        </div>
        <Select label="Region" hideLabel className="w-48" value={region} options={withAll("All regions", REGION_OPTIONS)} onChange={setRegion} />
      </div>
      {isPending && <div className="mt-4 h-24 animate-pulse rounded-xl bg-white/6" />}
      {isError && <p role="alert" className="mt-4 text-sm text-bad">Anomalies could not be read. Try again in a moment.</p>}
      {data?.length === 0 && <p className="mt-4 text-sm text-muted">No anomalies yet. A meter is judged against its own readings once it has sent eight of them.</p>}
      <ul className="mt-4 grid divide-y divide-line lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 [&>li]:border-line lg:[&>li]:border-b">
        {data?.slice(0, 8).map((a) => (
          <li key={`${a.meterId}-${a.kind}`} className="py-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-[13px]">{a.meterId}</span>
              <span className="text-[13px] text-warn">{KIND[a.kind] ?? a.kind}</span>
              <span className="text-[13px] text-muted tabular-nums">{a.county ?? a.region ?? ""} · {formatDateTime(a.at)} · score {a.score}</span>
            </p>
            {a.explanation && <p className="mt-1 text-[13px] text-muted">{a.explanation}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
