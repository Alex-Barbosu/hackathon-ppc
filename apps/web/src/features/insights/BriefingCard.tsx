import { formatDateTime } from "../../lib/format";
import { SourceChips } from "./SourceChips";
import { useBriefing } from "./useInsights";

export function BriefingCard() {
  const { data, isPending, isError } = useBriefing();
  if (isPending) return <div className="h-72 animate-pulse rounded-card bg-surface" aria-label="Loading the briefing" />;
  if (isError) return <p role="alert" className="rounded-card border border-line bg-surface p-6 text-sm">The briefing could not be built just now. Nothing is lost; the live numbers are on the Operations page.</p>;
  return (
    <article className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <p className="text-[13px] text-muted">
        Written {formatDateTime(data.generatedAt)}
        {data.cached ? " · served from the last saved version" : ""}
      </p>
      <p className="mt-3 max-w-2xl font-display text-2xl leading-snug">{data.summary}</p>
      <div className="mt-8 space-y-8">
        {data.sections.map((s) => (
          <section key={s.title} className="max-w-2xl">
            <h3 className="font-display text-lg">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line">{s.body}</p>
            <div className="mt-3"><SourceChips sources={(s.metrics ?? []).map((m) => ({ label: m.label ?? "", value: m.value ?? "", query: "briefing fact" }))} /></div>
          </section>
        ))}
      </div>
    </article>
  );
}
