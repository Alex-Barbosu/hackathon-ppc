import type { SourceChip } from "../../lib/domain";

/** Every number the analyst quotes comes with the query that produced it; the query is the tooltip. */
export function SourceChips({ sources }: { sources: readonly SourceChip[] }) {
  if (sources.length === 0) return null;
  return (
    <ul aria-label="Numbers used" className="flex flex-wrap gap-2">
      {sources.map((s, i) => (
        <li key={`${s.label}-${s.value}-${i}`} title={s.query} className="rounded-md border-[0.8px] border-line px-2.5 py-1 text-[13px] tabular-nums">
          <span className="text-muted">{s.label}</span> {s.value}
        </li>
      ))}
    </ul>
  );
}
