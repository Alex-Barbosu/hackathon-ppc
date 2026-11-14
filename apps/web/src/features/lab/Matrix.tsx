import { MatrixCell } from "./MatrixCell";
import { CATEGORY_ROWS, STORAGE_NAME, STORAGE_ORDER, type LabRun, type Category, type Storage } from "./types";

interface Props { run: LabRun | null | undefined; current: Partial<Record<Category, Storage>> }

export function Matrix({ run, current }: Props) {
  const rec = new Map(run?.recommendation.map((r) => [r.category, r.storage]));
  return (
    <section aria-label="Benchmark matrix" className="rounded-card border border-line bg-surface p-6">
      <div className="hidden grid-cols-[10rem_repeat(3,1fr)] gap-3 pb-3 lg:grid" aria-hidden>
        <span />
        {STORAGE_ORDER.map((s) => <span key={s} className="font-display text-lg">{STORAGE_NAME[s]}</span>)}
      </div>
      <div className="divide-y divide-line">
        {CATEGORY_ROWS.map((row) => (
          <div key={row.id} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[10rem_repeat(3,1fr)]">
            <div>
              <h3 className="font-display text-lg lg:text-base">{row.label}</h3>
              <p className="text-[13px] text-muted">{row.size}</p>
            </div>
            {row.id === "meter" ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted lg:col-span-3">
                Not benchmarked here: the meter simulator drives this category. PostgreSQL is current{current.meter ? ` (policy: ${STORAGE_NAME[current.meter]})` : ""}, for transactional de-duplication.
              </p>
            ) : STORAGE_ORDER.map((s) => {
              const cell = run?.cells.find((c) => c.category === row.id && c.storage === s);
              return cell ? (
                <MatrixCell key={s} cell={cell} recommended={rec.get(row.id) === s && run?.status === "done"} current={current[row.id] === s} />
              ) : (
                <div key={s} className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
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
