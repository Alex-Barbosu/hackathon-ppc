import { ChaosDock } from "../chaos/ChaosDock";
import { Toasts } from "../chaos/Toasts";
import { HeroCharts } from "./HeroCharts";
import { MeterIntegrity } from "./MeterIntegrity";
import { StorageStrip } from "./StorageStrip";
import { Tiles } from "./Tiles";

export function OperationsPage() {
  return (
    <div className="space-y-8 pb-24">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Operations</h1>
        <p className="mt-3 max-w-xl text-muted">Live from the last minute, refreshed every 5 seconds. Break something from the chaos dock and watch the guarantees hold.</p>
      </header>
      <StorageStrip />
      <Tiles />
      <HeroCharts />
      <MeterIntegrity />
      <ChaosDock />
      <Toasts />
    </div>
  );
}
