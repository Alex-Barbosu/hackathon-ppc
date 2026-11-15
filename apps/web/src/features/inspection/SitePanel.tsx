import { Chip } from "../../components/ui";
import { FLIGHT } from "./findings";
import { useSiteWeather } from "./useSiteWeather";

export const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${FLIGHT.site.lat},${FLIGHT.site.lon}`;

// Where the line is and what the weather is doing there now, so the crew can judge a re-flight or a site visit.
export function SitePanel() {
  const w = useSiteWeather();
  const { lat, lon, name } = FLIGHT.site;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
      <div className="min-w-0">
        <dt className="text-faint">Location</dt>
        <dd className="truncate text-muted">
          <a href={mapsUrl} target="_blank" rel="noreferrer" className="underline decoration-white/30 underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">{name} ↗</a>
        </dd>
      </div>
      <div className="min-w-0"><dt className="text-faint">Coordinates</dt><dd className="truncate font-mono text-xs text-muted">{lat.toFixed(4)}° N, {lon.toFixed(4)}° E</dd></div>
      <div className="min-w-0">
        <dt className="text-faint">Weather now</dt>
        <dd className="font-mono text-xs tabular-nums text-muted">
          {w.data ? `${w.data.tempC.toFixed(1)} °C · ${w.data.sky} · wind ${w.data.windMs.toFixed(1)} m/s` : w.isError ? "Weather service unreachable" : "Loading…"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-faint">Drone flight</dt>
        <dd>{w.data ? <Chip tone={w.data.flyable ? "good" : "warn"}>{w.data.flyable ? "Within limits" : "Outside limits"}</Chip> : <span className="text-muted">—</span>}
          {w.data && <span className="ml-2 font-mono text-xs tabular-nums text-faint">gusts {w.data.gustMs.toFixed(1)} m/s</span>}</dd>
      </div>
    </dl>
  );
}
