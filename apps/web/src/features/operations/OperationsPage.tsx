import { useAccess } from "../../state/useAccess";
import { PageHero, SectionTitle } from "../../components/PageHero";
import { Scrim, TexturePanel } from "../../components/Texture";
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
    <div className="space-y-16 sm:space-y-24">
      <PageHero label="Operations" title={<>Every guarantee, <em>live</em>.</>}>
        Live from the last minute, refreshed every 5 seconds.{chaos && " Break something from Chaos in the top bar and watch the guarantees hold."}
      </PageHero>
      <StatsRow />
      {/* Alerts sit on the sky panel: the first thing an operator should read. */}
      <TexturePanel texture="lines-sky" className="flex min-h-[320px] justify-center px-4 py-10 sm:px-10 sm:py-16">
        <Scrim texture="lines-sky" className="w-full max-w-3xl p-6 sm:p-8"><AlertFeed /></Scrim>
      </TexturePanel>
      <PagerPanel />
      <section className="space-y-10">
        <SectionTitle sub="PostgreSQL, S3 and FTPS, then latency, throughput and errors for each category.">
          <em>Watch</em> every storage at once.
        </SectionTitle>
        <StorageStrip />
        <Tiles />
      </section>
      <section className="space-y-10">
        <SectionTitle sub="A 10x storm in outage records should leave meter latency flat.">Storms stay in their <em>lane</em>.</SectionTitle>
        <HeroCharts />
      </section>
      <TexturePanel texture="amber" className="px-4 py-10 sm:px-10 sm:py-16">
        <Scrim texture="amber" className="mx-auto max-w-4xl p-6 sm:p-10"><MeterIntegrity /></Scrim>
      </TexturePanel>
    </div>
  );
}
