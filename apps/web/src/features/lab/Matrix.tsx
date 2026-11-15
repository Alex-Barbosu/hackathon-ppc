import { MatrixCell } from "./MatrixCell";
import { ExportButton } from "../../components/ExportButton";
import type { Column } from "../../lib/csv";
import type { Category, LabCell, LabRun, Storage } from "../../lib/domain";
import { CATEGORY_ROWS, STORAGE_NAME, STORAGE_ORDER } from "./constants";

const CELL_COLUMNS: Column<LabCell>[] = [
  { header: "Category", value: (c) => c.category }, { header: "Storage", value: (c) => c.storage },
  { header: "Samples", value: (c) => c.completed }, { header: "Write p95 ms", value: (c) => c.write?.p95Ms },
  { header: "Read p95 ms", value: (c) => c.read?.p95Ms }, { header: "Write MB/s", value: (c) => c.throughputMBps },
  { header: "Errors", value: (c) => c.errors }, { header: "Integrity ok", value: (c) => c.integrityOk },
];

interface Props { run: LabRun | null | undefined; current: Partial<Record<Category, Storage>> }

export function Matrix({ run, current }: Props) {
  const rec = new Map(run?.recommendation?.map((r) => [r.category, r.storage]));
  return (
    <section aria-label="Benchmark matrix" className="rounded-card border-[0.8px] border-line bg-surface p-5 sm:p-8">
      <div className="mb-4 flex justify-end"><ExportButton name="storage-lab" rows={run?.cells} columns={CELL_COLUMNS} /></div>
      <div className="hidden grid-cols-[10rem_repeat(3,1fr)] gap-3 pb-3 lg:grid" aria-hidden>
        <span />
        {STORAGE_ORDER.map((s) => <span key={s} className="caption text-muted">{STORAGE_NAME[s]}</span>)}
      </div>
      <div className="divide-y-[0.8px] divide-line">
        {CATEGORY_ROWS.map((row) => (
          <div key={row.id} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[10rem_repeat(3,1fr)]">
            <div>
              <h3 className="text-base font-normal">{row.label}</h3>
              <p className="text-[13px] text-muted">{row.size}</p>
            </div>
            {row.id === "meter" ? (
              <p className="rounded-widget border-[0.8px] border-dashed border-white/16 p-4 text-sm text-muted lg:col-span-3">
                Not benchmarked here: the meter simulator drives this category. PostgreSQL is current{current.meter ? ` (policy: ${STORAGE_NAME[current.meter]})` : ""}, for transactional de-duplication.
              </p>
            ) : STORAGE_ORDER.map((s) => {
              const cell = run?.cells?.find((c) => c.category === row.id && c.storage === s);
              return cell ? (
                <MatrixCell key={s} cell={cell} recommended={rec.get(row.id) === s && run?.status === "done"} current={current[row.id] === s} />
              ) : (
                <div key={s} className="rounded-widget border-[0.8px] border-dashed border-white/16 p-4 text-sm text-muted">
                  No result yet{current[row.id] === s ? " · current policy" : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
