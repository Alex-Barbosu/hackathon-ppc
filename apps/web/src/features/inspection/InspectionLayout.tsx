import type { ReactNode } from "react";
import { SectionTitle } from "../../components/PageHero";
import { FINDINGS } from "./findings";
import { FindingsList } from "./FindingsList";
import { InspectionPlayer } from "./InspectionPlayer";
import type { InspectionMedia } from "./media";
import type { PlayerState } from "./player";
import { SendFindings } from "./SendFindings";
import { SitePanel } from "./SitePanel";

interface LayoutProps { p: PlayerState; stills: InspectionMedia["stills"]; children: ReactNode }

export function InspectionLayout({ p, stills, children }: LayoutProps) {
  const high = FINDINGS.filter((f) => f.severity === "high").length;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="space-y-3 lg:col-span-8" aria-label="Inspection footage">
        <InspectionPlayer p={p}>{children}</InspectionPlayer>
        <SitePanel />
      </section>
      <section className="space-y-3 lg:col-span-4" aria-label="Findings">
        <div className="flex items-baseline justify-between">
          <SectionTitle>Findings</SectionTitle>
          <span className="text-[13px] tabular-nums text-muted">{FINDINGS.length} findings · {high} high</span>
        </div>
        <SendFindings />
        <FindingsList windows={p.windows} selected={p.selected} onFocus={p.focus} stills={stills} />
      </section>
    </div>
  );
}
