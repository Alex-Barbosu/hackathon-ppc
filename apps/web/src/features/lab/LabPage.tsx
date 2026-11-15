import { PageHero, SectionTitle } from "../../components/PageHero";
import { CARD } from "../../components/ui";
import { ApplyPolicy } from "./ApplyPolicy";
import { LabExplainer } from "./LabExplainer";
import { Matrix } from "./Matrix";
import { RecoCard } from "./RecoCard";
import { RunBar } from "./RunBar";
import { useCurrentPolicy, useLatestRun } from "./useLab";

export function LabPage() {
  const { data: run, isPending, isError } = useLatestRun();
  const policy = useCurrentPolicy();
  const current = policy.data ?? {};
  return (
    <div className="space-y-8">
      <PageHero label="Storage Lab" title="Storage Lab">
        Benchmarks every storage with real files per category, then recommends a policy and shows its working.
      </PageHero>
      <LabExplainer />
      <section className="space-y-6">
        <div className={`${CARD} p-5 sm:p-6`}><RunBar run={run} /></div>
        {isError && <p role="alert" className="text-sm text-bad">Storage Lab is unreachable. Nothing is lost; try again in a moment.</p>}
        {isPending ? <div className="h-96 animate-pulse rounded-card bg-surface" /> : <Matrix run={run} current={current} />}
      </section>
      {run?.recommendation && run.recommendation.length > 0 ? (
        <section aria-label="Recommendations" className="space-y-4">
          <SectionTitle sub="One storage per category, with the measurements behind it.">Recommended policy</SectionTitle>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {run.recommendation.map((r) => <RecoCard key={r.category} rec={r} current={current[r.category]} />)}
          </div>
          <ApplyPolicy recs={run.recommendation} />
        </section>
      ) : (
        !isPending && <p className="text-center text-sm text-muted">{run?.status === "running" ? "Recommendations appear when every cell has finished." : "No benchmark yet. Run one to see a recommendation for each category."}</p>
      )}
    </div>
  );
}
