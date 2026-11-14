import { AnomalyList } from "./AnomalyList";
import { AskBox } from "./AskBox";
import { BriefingCard } from "./BriefingCard";
import { HotspotList } from "./HotspotList";

export function InsightsPage() {
  return (
    <div className="space-y-8 pb-16">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Insights</h1>
        <p className="mt-3 max-w-xl text-muted">What the measurements say for a decision maker: which storage fits each category, how a peak compares with a normal day, and what the grid data shows.</p>
      </header>
      <BriefingCard />
      <AskBox />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AnomalyList />
        <HotspotList />
      </div>
    </div>
  );
}
