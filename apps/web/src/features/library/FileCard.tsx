import { StorageBadge } from "../../components/StorageBadge";
import { HashText } from "../../components/HashText";
import { Chip } from "../../components/ui";
import { REGIONS, type FileMeta } from "../../lib/domain";
import { formatBytes, formatDateTime } from "../../lib/format";
import { CategoryThumb } from "./CategoryThumb";
import { DownloadButton } from "./DownloadButton";
import { RecordingLine } from "./RecordingLine";

// Above this, buffering in the browser stops being safe; use a streamed link instead.
const STREAM_ABOVE_BYTES = 50 * 1024 * 1024;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="label text-[11px] text-faint">{label}</dt><dd className="mt-0.5 truncate text-sm">{children}</dd></div>;
}

export function FileCard({ file }: { file: FileMeta }) {
  const name = file.originalName ?? file.id;
  const region = REGIONS.find((r) => r.id === file.region)?.label;
  return (
    <li className="grid gap-4 border-t-[0.8px] border-line px-5 py-5 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 gap-4">
        <CategoryThumb category={file.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-normal">{name}</p>
            {file.status === "corrupt" && <Chip tone="bad">Corrupt</Chip>}
            {file.encrypted && <Chip tone="neutral">Encrypted</Chip>}
          </div>
          <RecordingLine recording={file.recording} />
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Fact label="Place">{file.county ? `${file.county}, ${region ?? ""}` : (region ?? "No region")}</Fact>
            <Fact label="Size">{formatBytes(file.sizeBytes)}</Fact>
            <Fact label="Stored">{formatDateTime(file.storedAt)}</Fact>
            <Fact label="Storage"><StorageBadge storage={file.storage} /></Fact>
          </dl>
          <div className="mt-2"><HashText value={file.sha256} /></div>
        </div>
      </div>
      <DownloadButton id={file.id} name={name} streamed={file.category === "video" || file.sizeBytes > STREAM_ABOVE_BYTES} />
    </li>
  );
}
