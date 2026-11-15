import { useAccess } from "../../state/useAccess";
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
  const { chaos } = useAccess();
  return (
    <div className="space-y-8">
      <PageHero label="Operations" title="Operations">
        Last minute, refreshed every 5 seconds.{chaos && " Chaos controls are in the top bar."}
      </PageHero>
      <StatsRow />
      {/* Alerts and meter integrity first: the two things an operator must be able to read at a glance. */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className={`${WIDGET} p-6`}><AlertFeed /></div>
        <div className={`${WIDGET} p-6`}><MeterIntegrity /></div>
      </div>
      <PagerPanel />
      <section className="space-y-4">
        <SectionTitle sub="Health per storage, then p95 latency, throughput and errors per category.">
          Storages and categories
        </SectionTitle>
        <StorageStrip />
        <Tiles />
      </section>
      <section className="space-y-4">
        <SectionTitle sub="A 10x storm in outage records should leave meter latency flat.">Bulkhead isolation</SectionTitle>
        <HeroCharts />
      </section>
      <GrafanaPanel />
    </div>
  );
}
