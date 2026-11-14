import { ApplyPolicy } from "./ApplyPolicy";
import { Matrix } from "./Matrix";
import { RecoCard } from "./RecoCard";
import { RunBar } from "./RunBar";
import { useCurrentPolicy, useLatestRun } from "./useLab";

export function LabPage() {
  const { data: run, isPending, isError } = useLatestRun();
  const policy = useCurrentPolicy();
  const current = policy.data ?? {};
  return (
    <div className="space-y-8 pb-16">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Storage Lab</h1>
        <p className="mt-3 max-w-xl text-muted">
          Uploads real files to each storage with the policy bypassed, downloads them back and checks the SHA-256, then recommends one storage per category with the numbers it used.
        </p>
      </header>
      <RunBar run={run} />
      {isError && <p role="alert" className="text-sm text-bad">Storage Lab is unreachable. Nothing is lost; try again in a moment.</p>}
      {isPending ? <div className="h-96 animate-pulse rounded-card bg-surface" /> : <Matrix run={run} current={current} />}
      {run?.recommendation && run.recommendation.length > 0 ? (
        <section aria-label="Recommendations" className="space-y-4">
          <h2 className="font-display text-2xl">Recommended policy</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {run.recommendation.map((r) => <RecoCard key={r.category} rec={r} current={current[r.category]} />)}
          </div>
          <ApplyPolicy recs={run.recommendation} />
        </section>
      ) : (
        !isPending && <p className="text-sm text-muted">{run?.status === "running" ? "Recommendations appear when every cell has finished." : "No benchmark yet. Run one to see a recommendation for each category."}</p>
      )}
    </div>
  );
}
