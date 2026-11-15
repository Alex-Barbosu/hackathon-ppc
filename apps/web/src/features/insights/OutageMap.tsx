import { lazy, Suspense, useMemo, useState } from "react";
import { ExportButton } from "../../components/ExportButton";
import type { Column } from "../../lib/csv";
import type { Hotspot } from "../../lib/domain";
import { CountyDetail } from "./map/CountyDetail";
import { LayerSwitch } from "./map/LayerSwitch";
import type { MapLayer } from "./map/MapCanvas";
import { MeterDetail } from "./map/MeterDetail";
import { buildAnomalyModel, buildMapModel } from "./map/model";
import { RegionShare } from "./map/RegionShare";
import { useAnomalies, useHotspots } from "./useInsights";

// The outlines are 45 KB; they load with the map, not with the app.
const MapCanvas = lazy(() => import("./map/MapCanvas").then((m) => ({ default: m.MapCanvas })));

const COLUMNS: Column<Hotspot>[] = [
  { header: "County", value: (h) => h.county }, { header: "Region", value: (h) => h.region },
  { header: "Outage records", value: (h) => h.outages }, { header: "Total minutes", value: (h) => h.totalMinutes },
  { header: "Last fault", value: (h) => h.lastFaultAt }, { header: "Top station", value: (h) => h.stations?.[0]?.station },
];
const LEGEND: Record<MapLayer, { to: string; text: string }> = {
  outages: { to: "to-[#965c12]", text: "More outage recordings" },
  meters: { to: "to-[#1e6096]", text: "More meters flagged" },
};

export function OutageMap() {
  const [layer, setLayer] = useState<MapLayer>("outages");
  const hotspots = useHotspots();
  const anomalies = useAnomalies("");
  const q = layer === "outages" ? hotspots : anomalies;
  const model = useMemo(() => (layer === "outages" ? buildMapModel(hotspots.data) : buildAnomalyModel(anomalies.data)), [layer, hotspots.data, anomalies.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? picked ?? model.dots[0]?.county;
  const dot = model.dots.find((d) => d.county === active) ?? model.dots[0];
  return (
    <section aria-label="Grid map" className="overflow-hidden rounded-card border-[0.8px] border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-[0.8px] border-line px-6 py-3 sm:px-8">
        <LayerSwitch value={layer} onChange={(l) => { setLayer(l); setPicked(null); }} />
        {layer === "outages" && <ExportButton name="outage-hotspots" rows={hotspots.data} columns={COLUMNS} />}
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-8 p-6 sm:p-8">
          {q.isError && <p role="alert" className="text-sm text-bad">The map data could not be read. Try again in a moment.</p>}
          <div className="-mx-2 sm:mx-0">
            <Suspense fallback={<div className="aspect-[613/433] w-full animate-pulse rounded-xl bg-white/4" />}>
              <MapCanvas layer={layer} dots={model.dots} active={dot?.county} onHover={setHover} onSelect={setPicked} />
            </Suspense>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-faint">
            <span>Fewer</span>
            <span aria-hidden className={`h-1.5 w-40 rounded-full bg-linear-to-r from-[#1d1d1d] ${LEGEND[layer].to}`} />
            <span>{LEGEND[layer].text}</span>
          </div>
          <RegionShare regions={model.regions} noun={layer === "outages" ? ["recording", "recordings"] : ["meter", "meters"]} />
        </div>
        <aside aria-live="polite" className="flex flex-col justify-between gap-10 border-t-[0.8px] border-line p-6 sm:p-10 lg:border-t-0 lg:border-l-[0.8px]">
          {q.isPending ? <div role="status" aria-label="Loading map data" className="h-64 animate-pulse rounded-xl bg-white/5" />
            : layer === "outages" ? <CountyDetail dot={dot} total={model.total} /> : <MeterDetail dot={dot} />}
          <p className="text-[12px] text-faint text-pretty">
            {model.unplaced > 0 && <>{model.unplaced} {model.unplaced === 1 ? "recording has" : "recordings have"} no county, so {model.unplaced === 1 ? "it counts" : "they count"} only toward the region. </>}
            Map: mapsvg.com, CC BY 4.0.
          </p>
        </aside>
      </div>
    </section>
  );
}
