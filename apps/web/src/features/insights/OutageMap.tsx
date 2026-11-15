import { lazy, Suspense, useMemo, useState } from "react";
import { ExportButton } from "../../components/ExportButton";
import type { Column } from "../../lib/csv";
import type { Hotspot } from "../../lib/domain";
import { CountyDetail } from "./map/CountyDetail";
import { buildMapModel } from "./map/model";
import { RegionShare } from "./map/RegionShare";
import { useHotspots } from "./useInsights";

// The outlines are 45 KB; they load with the map, not with the app.
const MapCanvas = lazy(() => import("./map/MapCanvas").then((m) => ({ default: m.MapCanvas })));

const COLUMNS: Column<Hotspot>[] = [
  { header: "County", value: (h) => h.county }, { header: "Region", value: (h) => h.region },
  { header: "Outage records", value: (h) => h.outages }, { header: "Total minutes", value: (h) => h.totalMinutes },
  { header: "Last fault", value: (h) => h.lastFaultAt }, { header: "Top station", value: (h) => h.stations?.[0]?.station },
];

export function OutageMap() {
  const { data, isError } = useHotspots();
  const model = useMemo(() => buildMapModel(data), [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? picked ?? model.dots[0]?.county;
  const dot = model.dots.find((d) => d.county === active) ?? model.dots[0];
  return (
    <section aria-label="Outage map" className="overflow-hidden rounded-card border-[0.8px] border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-[0.8px] border-line px-6 py-4 sm:px-8">
        <p className="label text-faint"><span className="max-sm:hidden">Outage recordings </span>by county{model.total ? ` · ${model.total}` : ""}</p>
        <ExportButton name="outage-hotspots" rows={data} columns={COLUMNS} />
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-10 p-6 sm:p-10">
          {isError && <p role="alert" className="text-sm text-bad">Hotspots could not be read. Try again in a moment.</p>}
          <div className="-mx-2 sm:mx-0">
            <Suspense fallback={<div className="aspect-[613/433] w-full animate-pulse rounded-xl bg-white/4" />}>
              <MapCanvas dots={model.dots} active={dot?.county} onHover={setHover} onSelect={setPicked} />
            </Suspense>
          </div>
          <RegionShare regions={model.regions} />
        </div>
        <aside aria-live="polite" className="flex flex-col justify-between gap-10 border-t-[0.8px] border-line p-6 sm:p-10 lg:border-t-0 lg:border-l-[0.8px]">
          <CountyDetail dot={dot} total={model.total} />
          <p className="text-[12px] text-faint text-pretty">
            {model.unplaced > 0 && <>{model.unplaced} {model.unplaced === 1 ? "recording has" : "recordings have"} no county, so {model.unplaced === 1 ? "it counts" : "they count"} only toward the region. </>}
            Map: mapsvg.com, CC BY 4.0.
          </p>
        </aside>
      </div>
    </section>
  );
}
