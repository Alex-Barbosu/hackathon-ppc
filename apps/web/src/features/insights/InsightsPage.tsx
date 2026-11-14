import { PageHero, SectionTitle } from "../../components/PageHero";
import { AnomalyList } from "./AnomalyList";
import { AskBox } from "./AskBox";
import { BriefingCard } from "./BriefingCard";
import { HotspotList } from "./HotspotList";

export function InsightsPage() {
  return (
    <div className="space-y-16 sm:space-y-24">
      <PageHero label="Insights" title={<>What the data <em>says</em>.</>}>
        For a decision maker: which storage fits each category, how a peak compares with a normal day, and what the grid data shows.
      </PageHero>
      <BriefingCard />
      <AskBox />
      <section className="space-y-10">
        <SectionTitle sub="Meters judged against their own history, outages counted by county.">The grid, <em>up close</em>.</SectionTitle>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <AnomalyList />
          <HotspotList />
        </div>
      </section>
    </div>
  );
}
