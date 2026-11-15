import { PageHero, SectionTitle } from "../../components/PageHero";
import { AnomalyList } from "./AnomalyList";
import { AskCard } from "./AskCard";
import { BriefingCard } from "./BriefingCard";
import { OutageMap } from "./OutageMap";

export function InsightsPage() {
  return (
    <div className="space-y-16 sm:space-y-24">
      <PageHero label="Insights" title={<>What the data <em>says</em>.</>}>
        For a decision maker: which storage fits each category, how a peak compares with a normal day, and what the grid data shows.
      </PageHero>
      <BriefingCard />
      <section className="space-y-10">
        <SectionTitle sub="Every outage recording placed on its county. The bigger the dot, the more recordings. Pick a county to see its stations.">Where the grid <em>breaks</em>.</SectionTitle>
        <OutageMap />
      </section>
      <AskCard />
      <section className="space-y-10">
        <SectionTitle sub="Each meter judged against its own history: drops, spikes, stuck readings and voltage sags.">Meters, <em>up close</em>.</SectionTitle>
        <AnomalyList />
      </section>
    </div>
  );
}
