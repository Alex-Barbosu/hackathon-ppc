import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Q } from "./prom";
import { usePromRange, type Point } from "./usePromQuery";

const time = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function Chart({ title, takeaway, data, unit, color, scale = 1 }: {
  title: string; takeaway: string; data: Point[] | undefined; unit: string; color: string; scale?: number;
}) {
  const rows = (data ?? []).map((p) => ({ t: p.t, v: p.v == null ? null : p.v * scale }));
  return (
    <article className="rounded-card border border-line bg-surface p-6">
      <h3 className="font-display text-lg">{title}</h3>
      <p className="mt-1 text-[13px] text-muted">{takeaway}</p>
      <div className="mt-4 h-52" role="img" aria-label={`${title}, last 10 minutes`}>
        {rows.length === 0 ? (
          <p className="pt-16 text-sm text-muted">No samples in the last 10 minutes yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="t" tickFormatter={time} stroke="var(--color-muted)" fontSize={12} tickLine={false} minTickGap={48} />
              <YAxis stroke="var(--color-muted)" fontSize={12} tickLine={false} axisLine={false} width={48} domain={[0, "auto"]} />
              <Tooltip labelFormatter={(t) => time(Number(t))} formatter={(v) => [`${Number(v).toFixed(1)} ${unit}`, title]} />
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
    <section aria-label="Storm isolation" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Chart title="Meter p95 latency" takeaway="Meter latency stays flat while another category is under storm." data={meter.data} unit="ms" scale={1000} color="var(--color-accent)" />
      {useQueue ? (
        <Chart title="Outage queue depth" takeaway="Items waiting in the outage bulkhead." data={queue.data} unit="items" color="var(--color-warn)" />
      ) : (
        <Chart title="Outage writes per second" takeaway="Outage load; queue depth is not reported yet." data={rate.data} unit="ops/s" color="var(--color-warn)" />
      )}
    </section>
  );
}
