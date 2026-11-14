import { Link } from "@tanstack/react-router";
import { FileCard } from "./FileCard";
import { SearchBar } from "./SearchBar";
import { useFileSearch } from "./useFileSearch";

function Skeleton() {
  return (
    <div className="space-y-4" aria-label="Loading files">
      {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-card border border-line bg-surface" />)}
    </div>
  );
}

export function LibraryPage() {
  const { data, isLoading, isError, refetch } = useFileSearch();
  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">Library</h1>
      <p className="mt-3 max-w-xl text-muted">Find a stored file and download it. Each download is checked against its SHA-256 as it streams.</p>
      <div className="mt-10"><SearchBar /></div>
      <div className="mt-10 space-y-4">
        {isLoading && <Skeleton />}
        {isError && (
          <p role="alert" className="rounded-card border border-line bg-surface p-6 text-sm">
            The search could not reach the API. Stored files are not affected.{" "}
            <button type="button" className="text-accent underline" onClick={() => void refetch()}>Try again</button>
          </p>
        )}
        {data && data.items.length === 0 && (
          <p className="rounded-card border border-line bg-surface p-6 text-sm text-muted">
            No files match. Matching files will appear here; <Link to="/" className="text-accent underline">upload one</Link> to get started.
          </p>
        )}
        {data && data.items.length > 0 && (
          <>
            <p className="text-[13px] text-muted tabular-nums">{data.total} {data.total === 1 ? "file" : "files"}</p>
            {data.items.map((f) => <FileCard key={f.id} file={f} />)}
          </>
        )}
      </div>
    </div>
  );
}
