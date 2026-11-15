import type { ReactNode } from "react";
import { SectionTitle } from "../../components/PageHero";
import { FINDINGS, FLIGHT } from "./findings";
import { FindingsList } from "./FindingsList";
import { InspectionPlayer } from "./InspectionPlayer";
import type { InspectionMedia } from "./media";
import type { PlayerState } from "./player";

interface LayoutProps { p: PlayerState; stills: InspectionMedia["stills"]; children: ReactNode }

export function InspectionLayout({ p, stills, children }: LayoutProps) {
  const high = FINDINGS.filter((f) => f.severity === "high").length;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="space-y-3 lg:col-span-8" aria-label="Inspection footage">
        <InspectionPlayer p={p}>{children}</InspectionPlayer>
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
        <FindingsList windows={p.windows} selected={p.selected} onFocus={p.focus} stills={stills} />
      </section>
    </div>
  );
}
