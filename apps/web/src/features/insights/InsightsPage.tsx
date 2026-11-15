import { PageHero, SectionTitle } from "../../components/PageHero";
import { AnomalyList } from "./AnomalyList";
import { BriefingCard } from "./BriefingCard";
import { OutageMap } from "./OutageMap";

// The map leads: it is the screen's one picture of the grid, and the briefing below explains it.
export function InsightsPage() {
  return (
    <div className="space-y-8">
      <PageHero title="Insights" />
      <OutageMap />
      <section className="space-y-4">
        <SectionTitle>Meter anomalies</SectionTitle>
        <AnomalyList />
      </section>
      <section className="space-y-4">
        <SectionTitle>Briefing</SectionTitle>
        <BriefingCard />
      </section>
    </div>
  );
}
