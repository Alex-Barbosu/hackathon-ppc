import { Scrim, TexturePanel } from "../../components/Texture";
import { CARD } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { BriefingSection } from "./BriefingSection";
import { useBriefing } from "./useInsights";

export function BriefingCard() {
  const { data, isPending, isError } = useBriefing();
  if (isPending) return <div className="h-80 animate-pulse rounded-card bg-surface" aria-label="Loading the briefing" />;
  if (isError) return <p role="alert" className={`${CARD} p-6 text-sm`}>The briefing could not be built just now. Nothing is lost; the live numbers are on the Operations page.</p>;
  return (
    <article aria-label="Briefing" className="space-y-6">
      {/* The headline finding sits on a landscape, like Origin's feature photo cards. */}
      <TexturePanel texture="lines-dusk" className="flex min-h-[360px] items-end p-4 sm:p-8">
        <Scrim texture="lines-dusk" className="max-w-2xl p-6 sm:p-8">
          <p className="label text-white/75">
            The briefing · {formatDateTime(data.generatedAt)}{data.cached ? " · last saved version" : ""}
          </p>
          <p className="mt-4 font-display text-[28px] leading-[1.15] text-white/90 text-pretty sm:text-4xl">{data.summary}</p>
        </Scrim>
      </TexturePanel>
      {/* One row per question from the brief, so it reads top to bottom like a memo, not a dashboard. */}
      <div className={`${CARD} divide-y divide-line px-6 sm:px-8`}>
        {data.sections.map((s, i) => <BriefingSection key={s.title ?? i} index={i + 1} title={s.title ?? ""} body={s.body ?? ""} metrics={s.metrics ?? []} />)}
      </div>
    </article>
  );
}
