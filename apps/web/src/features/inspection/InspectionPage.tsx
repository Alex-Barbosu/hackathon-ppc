import { PageHero, SectionTitle } from "../../components/PageHero";
import { FINDINGS, FLIGHT } from "./findings";
import { FindingsList } from "./FindingsList";
import { InspectionPlayer } from "./InspectionPlayer";
import { useInspectionPlayer } from "./useInspectionPlayer";

// Honesty first: this is a preview of the detector on one rendered flight, with precomputed output.
// It never creates work orders, and the page says so where the judge's eye lands.
export function InspectionPage() {
  const p = useInspectionPlayer();
  const high = FINDINGS.filter((f) => f.severity === "high").length;
  return (
    <div className="space-y-6">
      <PageHero title="Line inspection" actions={<span className="caption text-warn">Preview · detection model in testing, findings are not sent to work orders</span>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="space-y-3 lg:col-span-8" aria-label="Inspection footage">
          <InspectionPlayer p={p} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            {[["Line", FLIGHT.section], ["Region", FLIGHT.region], ["Flown", FLIGHT.flown], ["Source file", FLIGHT.file]].map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-faint">{k}</dt><dd className="truncate font-mono text-xs text-muted">{v}</dd></div>
            ))}
          </dl>
        </section>
        <section className="space-y-3 lg:col-span-4" aria-label="Findings">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Findings</SectionTitle>
            <span className="text-[13px] tabular-nums text-muted">{FINDINGS.length} findings · {high} high</span>
          </div>
          <FindingsList windows={p.windows} selected={p.selected} onFocus={p.focus} />
        </section>
      </div>
    </div>
  );
}
