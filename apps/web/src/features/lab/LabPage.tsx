import { PageHero, SectionTitle } from "../../components/PageHero";
import { CARD } from "../../components/ui";
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
    <div className="space-y-16 sm:space-y-24">
      <PageHero label="Storage Lab" title={<>Let the numbers <em>choose</em>.</>}>
        Uploads real files to each storage with the policy bypassed, downloads them back and checks the SHA-256, then recommends one storage per category with the numbers it used.
      </PageHero>
      <section className="space-y-6">
        <div className={`${CARD} p-5 sm:p-8`}><RunBar run={run} /></div>
        {isError && <p role="alert" className="text-sm text-bad">Storage Lab is unreachable. Nothing is lost; try again in a moment.</p>}
        {isPending ? <div className="h-96 animate-pulse rounded-card bg-surface" /> : <Matrix run={run} current={current} />}
      </section>
      {run?.recommendation && run.recommendation.length > 0 ? (
        <section aria-label="Recommendations" className="space-y-10">
          <SectionTitle sub="One storage per category, with the measurements behind it.">Recommended <em>policy</em>.</SectionTitle>
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
