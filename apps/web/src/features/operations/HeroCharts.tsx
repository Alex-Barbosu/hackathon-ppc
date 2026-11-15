import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Q } from "./prom";
import { usePromRange, type Point } from "./usePromQuery";

// Recharts paints its tooltip white by default; match the dark widget panel instead.
const TIP = { background: "#121212", border: "0.8px solid rgb(255 255 255 / 0.16)", borderRadius: 12, fontSize: 13 };
const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function Chart({ title, data, unit, color, scale = 1 }: {
  title: string; data: Point[] | undefined; unit: string; color: string; scale?: number;
}) {
  const rows = (data ?? []).map((p) => ({ t: p.t, v: p.v == null ? null : p.v * scale }));
  return (
    <article className="rounded-card border-[0.8px] border-line bg-surface p-6 sm:p-8">
      <h3 className="text-lg font-normal">{title}</h3>
      <div className="mt-4 h-52" role="img" aria-label={`${title}, last 10 minutes`}>
        {rows.length === 0 ? (
          <p className="pt-16 text-sm text-muted">No samples in the last 10 minutes yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="t" tickFormatter={time} stroke="var(--color-muted)" fontSize={12} tickLine={false} minTickGap={48} />
              <YAxis stroke="var(--color-muted)" fontSize={12} tickLine={false} axisLine={false} width={48} domain={[0, "auto"]} />
              <Tooltip contentStyle={TIP} labelStyle={{ color: "var(--color-muted)" }} itemStyle={{ color: "var(--color-ink)" }} cursor={{ stroke: "var(--color-line-strong)" }} labelFormatter={(t) => time(Number(t))} formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, title]} />
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.08} isAnimationActive={false} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
}

export function HeroCharts() {
  const meter = usePromRange(Q.meterP95);
  const queue = usePromRange(Q.outageQueue);
  const rate = usePromRange(Q.outageRate);
  // Queue depth is the planned signal; until zone A emits it, outage write rate shows the same storm.
  const useQueue = (queue.data?.length ?? 0) > 0;
  return (
    <section aria-label="Storm isolation" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Chart title="Meter p95 latency" data={meter.data} unit="ms" scale={1000} color="var(--color-chart)" />
      {useQueue ? (
        <Chart title="Outage queue depth" data={queue.data} unit="items" color="var(--color-warn)" />
      ) : (
        <Chart title="Outage writes per second" data={rate.data} unit="ops/s" color="var(--color-warn)" />
      )}
    </section>
  );
}
