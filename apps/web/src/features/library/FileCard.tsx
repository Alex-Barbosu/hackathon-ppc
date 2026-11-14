import { StorageBadge } from "../../components/StorageBadge";
import { HashText } from "../../components/HashText";
import { REGIONS, type FileMeta } from "../../lib/domain";
import { formatBytes, formatDateTime } from "../../lib/format";
import { DownloadButton } from "./DownloadButton";
import { RecordingLine } from "./RecordingLine";

// Above this, buffering in the browser stops being safe; use a streamed link instead.
const STREAM_ABOVE_BYTES = 50 * 1024 * 1024;

export function FileCard({ file }: { file: FileMeta }) {
  const name = file.originalName ?? file.id;
  return (
    <li className="flex flex-col gap-4 border-t-[0.8px] border-line px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-base font-normal break-words">{name}</p>
        <p className="mt-1 text-[13px] text-faint tabular-nums">
          <span className="capitalize">{file.category}</span> · {file.county ? `${file.county}, ` : ""}{REGIONS.find((r) => r.id === file.region)?.label ?? "no region"} · {formatBytes(file.sizeBytes)} · {formatDateTime(file.storedAt)}
        </p>
        <RecordingLine recording={file.recording} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StorageBadge storage={file.storage} />
          {file.status === "corrupt" && <span className="rounded-md bg-bad-soft px-2 py-1 text-[13px] text-bad">Corrupt</span>}
          <HashText value={file.sha256} />
        </div>
      </div>
      <DownloadButton id={file.id} name={name} streamed={file.category === "video" || file.sizeBytes > STREAM_ABOVE_BYTES} />
    </li>
  );
}
