import { PageHero, SectionTitle } from "../../components/PageHero";
import { WIDGET } from "../../components/ui";
import { GrafanaPanel } from "./GrafanaPanel";
import { AlertFeed } from "./AlertFeed";
import { HeroCharts } from "./HeroCharts";
import { MeterIntegrity } from "./MeterIntegrity";
import { PagerPanel } from "./PagerPanel";
import { StatsRow } from "./StatsRow";
import { StorageStrip } from "./StorageStrip";
import { Tiles } from "./Tiles";

export function OperationsPage() {
  return (
    <div className="space-y-8">
      <PageHero title="Operations" />
      <StatsRow />
      {/* Alerts and meter integrity first: the two things an operator must be able to read at a glance. */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className={`${WIDGET} p-6`}><AlertFeed /></div>
        <div className={`${WIDGET} p-6`}><MeterIntegrity /></div>
      </div>
      <PagerPanel />
      <section className="space-y-4">
        <SectionTitle>
          Storages and categories
        </SectionTitle>
        <StorageStrip />
        <Tiles />
      </section>
      <section className="space-y-4">
        <SectionTitle>Bulkhead isolation</SectionTitle>
        <HeroCharts />
      </section>
      <GrafanaPanel />
    </div>
  );
}
