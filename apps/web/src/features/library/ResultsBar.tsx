import { SecondaryButton } from "../../components/ui";
import { PAGE_SIZE, useFilters } from "./useFileSearch";
import { useExportFiles } from "./useExportFiles";

export function ResultsBar({ total }: { total: number }) {
  const { page, setPage } = useFilters();
  const exp = useExportFiles();
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3.5">
      <p className="caption text-muted" aria-live="polite">{first}–{last} of {total} {total === 1 ? "file" : "files"}</p>
      <div className="flex flex-wrap items-center gap-2">
        {exp.data && <span className="text-[13px] text-good">Exported {exp.data.count}{exp.data.total > exp.data.count ? ` of ${exp.data.total}` : ""} rows</span>}
        {exp.isError && <span role="alert" className="text-[13px] text-bad">{exp.error.message}</span>}
        <SecondaryButton disabled={exp.isPending || total === 0} onClick={() => exp.mutate()}>{exp.isPending ? "Exporting…" : "Export CSV"}</SecondaryButton>
        <SecondaryButton aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</SecondaryButton>
        <SecondaryButton aria-label="Next page" disabled={last >= total} onClick={() => setPage(page + 1)}>Next</SecondaryButton>
      </div>
    </div>
  );
}
