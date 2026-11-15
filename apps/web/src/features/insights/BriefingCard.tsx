import { CARD } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { BriefingSection } from "./BriefingSection";
import { useBriefing } from "./useInsights";

export function BriefingCard() {
  const { data, isPending, isError } = useBriefing();
  if (isPending) {
    return (
      <div role="status" className={`${CARD} flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center`}>
        <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
        <p className="text-sm">Building the briefing from live measurements…</p>
        <p className="text-[13px] text-faint">The first one after a restart can take up to half a minute. It is cached afterwards.</p>
      </div>
    );
  }
  if (isError) return <p role="alert" className={`${CARD} p-6 text-sm`}>The briefing could not be built just now. Nothing is lost; the live numbers are on the Operations page.</p>;
  return (
    <article aria-label="Briefing" className="space-y-4">
      <div className={`${CARD} p-6 sm:p-8`}>
        <p className="label text-faint">Briefing · {formatDateTime(data.generatedAt)}{data.cached ? " · last saved version" : ""}</p>
        <p className="mt-3 max-w-4xl font-display text-[24px] leading-[1.25] text-pretty sm:text-[28px]">{data.summary}</p>
      </div>
      {/* One row per question from the brief, so it reads top to bottom like a memo, not a dashboard. */}
      <div className={`${CARD} divide-y divide-line px-6 sm:px-8`}>
        {data.sections.map((s, i) => <BriefingSection key={s.title ?? i} index={i + 1} title={s.title ?? ""} body={s.body ?? ""} metrics={s.metrics ?? []} />)}
      </div>
    </article>
  );
}
