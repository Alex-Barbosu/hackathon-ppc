import { downloadCsv, stamp, toCsv, type Column } from "../lib/csv";

interface ExportButtonProps<T> { name: string; rows: readonly T[] | undefined; columns: readonly Column<T>[] }

// Small, quiet export for panels whose data is already on screen; the Library has its own paged export.
export function ExportButton<T>({ name, rows, columns }: ExportButtonProps<T>) {
  const empty = !rows || rows.length === 0;
  return (
    <button type="button" disabled={empty} onClick={() => rows && downloadCsv(`filegrid-${name}-${stamp()}.csv`, toCsv(rows, columns))}
      className="label inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white/8 px-3 text-ink transition-colors hover:bg-white/14 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1.5v6.5M3.2 5.5 6 8.3l2.8-2.8M2 10.5h8" /></svg>
      CSV
    </button>
  );
}
