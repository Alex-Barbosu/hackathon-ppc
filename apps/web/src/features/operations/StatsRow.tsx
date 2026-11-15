import { Stagger, StaggerItem } from "../../components/motion/Reveal";
import { Ticker } from "../../components/motion/Ticker";
import { Q } from "./prom";
import { useIncidents } from "./useIncidents";
import { usePromQuery } from "./usePromQuery";
import { useStoragesHealth } from "./useStoragesHealth";

const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
const perSec = (n: number) => n.toFixed(n >= 10 ? 0 : 1);

// Origin's stats row: four numbers a judge can read from across the room before any chart.
export function StatsRow() {
  const health = useStoragesHealth().data;
  const firing = useIncidents().data?.filter((i) => i.status === "firing").length;
  const stored = usePromQuery(Q.storedAccepted).data?.get("");
  const rate = usePromQuery(Q.throughput).data;
  const total = rate ? [...rate.values()].reduce<number>((a, v) => a + (v ?? 0), 0) : undefined;
  const up = health?.filter((s) => s.up && !s.circuitOpen).length;
  const all = health?.length ?? 3;
  const stats = [
    { label: "Storages up", value: up, format: (n: number) => `${Math.round(n)}/${all}`, bad: up != null && up < all },
    { label: "Alerts firing", value: firing, format: whole, bad: (firing ?? 0) > 0 },
    { label: "Readings stored, 10 min", value: stored, format: whole, bad: false },
    { label: "Operations per second", value: total, format: perSec, bad: false },
  ];
  return (
    <Stagger as="dl" className="grid grid-cols-2 gap-y-8 lg:grid-cols-4 lg:divide-x-[0.8px] lg:divide-line">
      {stats.map((s) => (
        <StaggerItem key={s.label} className="flex flex-col-reverse px-2 text-center lg:px-6">
          <dt className="caption mt-3 text-muted">{s.label}</dt>
          <dd className={`font-display text-[48px] leading-none transition-colors duration-500 sm:text-[64px] ${s.bad ? "text-bad" : ""}`}><Ticker value={s.value} format={s.format} /></dd>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
