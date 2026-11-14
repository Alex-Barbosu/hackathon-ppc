import { Q } from "./prom";
import { useIncidents } from "./useIncidents";
import { usePromQuery } from "./usePromQuery";
import { useStoragesHealth } from "./useStoragesHealth";

// Origin's stats row: four numbers a judge can read from across the room before any chart.
export function StatsRow() {
  const health = useStoragesHealth().data;
  const firing = useIncidents().data?.filter((i) => i.status === "firing").length;
  const stored = usePromQuery(Q.storedAccepted).data?.get("");
  const rate = usePromQuery(Q.throughput).data;
  const total = rate ? [...rate.values()].reduce<number>((a, v) => a + (v ?? 0), 0) : undefined;
  const up = health?.filter((s) => s.up && !s.circuitOpen).length;
  const stats = [
    { label: "Storages up", value: up == null ? "–" : `${up}/${health?.length ?? 3}`, bad: up != null && up < (health?.length ?? 3) },
    { label: "Alerts firing", value: firing == null ? "–" : String(firing), bad: (firing ?? 0) > 0 },
    { label: "Readings stored, 10 min", value: stored == null ? "–" : Math.round(stored).toLocaleString("en-GB"), bad: false },
    { label: "Operations per second", value: total == null ? "–" : total.toFixed(total >= 10 ? 0 : 1), bad: false },
  ];
  return (
    <dl className="grid grid-cols-2 gap-y-8 lg:grid-cols-4 lg:divide-x-[0.8px] lg:divide-line">
      {stats.map((s) => (
        <div key={s.label} className="px-2 text-center lg:px-6">
          <dd className={`font-display text-[48px] leading-none tabular-nums sm:text-[64px] ${s.bad ? "text-bad" : ""}`}>{s.value}</dd>
          <dt className="label mt-3 text-faint">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}
