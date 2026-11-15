import { FINDINGS, FLIGHT, KIND_LABEL } from "./findings";
import type { SiteWeather } from "./useSiteWeather";

export const TEAMS = [
  { id: "maintenance", label: "Line maintenance, Prahova", to: "mentenanta.prahova@example.ro" },
  { id: "vegetation", label: "Vegetation crew", to: "vegetatie.prahova@example.ro" },
  { id: "dispatch", label: "Dispatch Muntenia", to: "dispecerat.muntenia@example.ro" },
] as const;
export type TeamId = (typeof TEAMS)[number]["id"];

/** Plain-text report a crew can read on a phone: one line per finding, the place and the weather. */
export function buildReport(maps: string, w: SiteWeather | undefined): { subject: string; body: string } {
  const lines = FINDINGS.map((f) => `${f.id}  ${KIND_LABEL[f.kind]} (${f.severity}, ${f.confidence.toFixed(2)})  ${f.span}\n    ${f.detail}`);
  const weather = w ? `${w.tempC.toFixed(1)} °C, ${w.sky}, wind ${w.windMs.toFixed(1)} m/s, gusts ${w.gustMs.toFixed(1)} m/s` : "not available";
  return {
    subject: `Inspection findings: ${FLIGHT.line} (${FLIGHT.section})`,
    body: [
      `${FLIGHT.line}, ${FLIGHT.section}. Flown ${FLIGHT.flown}.`,
      `Location: ${FLIGHT.site.name}, ${FLIGHT.site.lat}, ${FLIGHT.site.lon}`,
      `Map: ${maps}`,
      `Weather on site now: ${weather}`,
      "",
      ...lines,
      "",
      `Model ${FLIGHT.model}: findings are a preview and need confirmation on site.`,
    ].join("\n"),
  };
}
