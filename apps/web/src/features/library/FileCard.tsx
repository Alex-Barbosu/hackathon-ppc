import { StorageBadge } from "../../components/StorageBadge";
import { HashText } from "../../components/HashText";
import type { FileMeta } from "../../lib/domain";
import { formatBytes, formatDateTime } from "../../lib/format";
import { DownloadButton } from "./DownloadButton";

export function FileCard({ file }: { file: FileMeta }) {
  const name = file.originalName ?? file.id;
  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-display text-xl break-words">{name}</p>
        <p className="mt-1 text-[13px] text-muted tabular-nums">
          {file.category} · {file.region ?? "no region"} · {formatBytes(file.sizeBytes)} · {formatDateTime(file.storedAt)}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StorageBadge storage={file.storage} />
          {file.status === "corrupt" && <span className="rounded-full bg-bad/10 px-2.5 py-1 text-xs font-medium text-bad">Corrupt</span>}
          <HashText value={file.sha256} />
        </div>
      </div>
      <DownloadButton id={file.id} name={name} />
    </article>
  );
}
