import { RichText } from "./RichText";

interface Metric { label?: string; value?: string }

export function BriefingSection({ title, body, metrics }: { title: string; body: string; metrics: Metric[] }) {
  return (
    <section className="grid gap-6 py-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div>
        <h3 className="font-display text-[28px] leading-[1.15] text-white/90">{title}</h3>
      </div>
      <div className="space-y-6">
        <RichText text={body} />
        {metrics.length > 0 && (
          // The numbers the text relied on, each an exact copy of a measurement, so a reader can check the claim.
          <dl className="flex flex-wrap gap-px overflow-hidden rounded-xl bg-line">
            {metrics.slice(0, 4).map((m) => (
              <div key={`${m.label}${m.value}`} className="min-w-[140px] flex-1 bg-panel px-4 py-3">
                <dt className="text-xs leading-4 text-faint">{m.label}</dt>
                <dd className="mt-2 text-lg tabular-nums text-white">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
