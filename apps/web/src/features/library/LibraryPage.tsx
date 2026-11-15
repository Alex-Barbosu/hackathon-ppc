import { Link } from "@tanstack/react-router";
import { PageHero } from "../../components/PageHero";
import { CARD, WIDGET } from "../../components/ui";
import { FileCard } from "./FileCard";
import { ResultsBar } from "./ResultsBar";
import { SearchBar } from "./SearchBar";
import { useFileSearch } from "./useFileSearch";

function Skeleton() {
  return (
    <div className={WIDGET} aria-label="Loading files">
      {[0, 1, 2].map((i) => <div key={i} className="m-4 h-20 animate-pulse rounded-lg bg-white/6" />)}
    </div>
  );
}

export function LibraryPage() {
  const { data, isLoading, isError, refetch } = useFileSearch();
  return (
    <>
      <PageHero title="Library" />
      <div className={`${CARD} mt-6 p-5 sm:p-6`}><SearchBar /></div>
      <div className="mt-6">
        {isLoading && <Skeleton />}
        {isError && (
          <p role="alert" className={`${CARD} p-6 text-sm`}>
            The search could not reach the API. Stored files are not affected.{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => void refetch()}>Try again</button>
          </p>
        )}
        {data && data.items.length === 0 && (
          <p className={`${CARD} p-6 text-sm text-muted`}>
            No files match. Matching files will appear here; <Link to="/" className="text-ink underline underline-offset-4">upload one</Link> to get started.
          </p>
        )}
        {data && data.items.length > 0 && (
          <section aria-label="Files" className={WIDGET}>
            <ResultsBar total={data.total} />
            <ul>{data.items.map((f) => <FileCard key={f.id} file={f} />)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
