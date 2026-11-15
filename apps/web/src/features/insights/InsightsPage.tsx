import { PageHero, SectionTitle } from "../../components/PageHero";
import { AnomalyList } from "./AnomalyList";
import { BriefingCard } from "./BriefingCard";
import { OutageMap } from "./OutageMap";

export function InsightsPage() {
  return (
    <div className="space-y-8">
      <PageHero label="Insights" title="Insights">
        Storage fit per category, peak against normal, and what the grid data shows.
      </PageHero>
      <BriefingCard />
      <section className="space-y-4">
        <SectionTitle sub="Outage recordings by county. Darker counties and larger dots carry more. Select a county for its stations.">Outage hotspots</SectionTitle>
        <OutageMap />
      </section>
      <section className="space-y-4">
        <SectionTitle sub="Each meter judged against its own history: drops, spikes, stuck readings and voltage sags.">Meter anomalies</SectionTitle>
        <AnomalyList />
      </section>
    </div>
  );
}
