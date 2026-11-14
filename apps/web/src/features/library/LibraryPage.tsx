import { Link } from "@tanstack/react-router";
import { PageHero } from "../../components/PageHero";
import { CARD, WIDGET } from "../../components/ui";
import { FileCard } from "./FileCard";
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
      <PageHero label="Library" title={<>Find it, <em>prove</em> it.</>}>
        Find a stored file and download it. Each download is checked against its SHA-256 as it streams.
      </PageHero>
      <div className={`${CARD} mt-12 p-5 sm:p-8`}><SearchBar /></div>
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
            <p className="label px-5 pt-4 pb-3.5 text-faint">{data.total} {data.total === 1 ? "file" : "files"}</p>
            <ul>{data.items.map((f) => <FileCard key={f.id} file={f} />)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
