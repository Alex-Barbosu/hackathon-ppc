import { SecondaryButton } from "../../components/ui";
import { useDownload } from "./useDownload";

interface DownloadButtonProps {
  id: string;
  name: string;
  streamed: boolean;
}

export function DownloadButton({ id, name, streamed }: DownloadButtonProps) {
  const download = useDownload(id, name, streamed);
  const result = download.data;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <SecondaryButton disabled={download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? "Verifying…" : "Download"}
      </SecondaryButton>
      {result?.kind === "verified" && (
        <p className="flex items-center gap-1.5 text-[13px] text-good"><span className="size-1.5 rounded-full bg-good" aria-hidden />Verified, SHA-256 matches</p>
      )}
      {result?.kind === "started" && (
        <p className="max-w-xs text-[13px] text-muted sm:text-right">Download started. Expected SHA-256 <span className="font-mono">{result.sha256.slice(0, 12)}…</span></p>
      )}
      {result?.kind === "integrity-failed" && (
        <p role="alert" className="max-w-xs text-[13px] text-bad sm:text-right">
          Integrity failed. The stored bytes differ from what was uploaded, so nothing was downloaded. The failure is recorded and raises an integrity alert for the operations team.
        </p>
      )}
      {download.isError && <p role="alert" className="text-[13px] text-bad">{download.error.message}</p>}
    </div>
  );
}
