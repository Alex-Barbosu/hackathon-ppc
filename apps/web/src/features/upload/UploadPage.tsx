import { FIELD, PrimaryButton } from "../../components/ui";
import { REGIONS, type Region } from "../../lib/domain";
import { CategoryPicker } from "./CategoryPicker";
import { DropZone } from "./DropZone";
import { ReceiptCard } from "./ReceiptCard";
import { TusProgress } from "./TusProgress";
import { useTusUpload } from "./useTusUpload";
import { useUpload } from "./useUpload";
import { useUploadForm } from "./useUploadForm";

export function UploadPage() {
  const { category, region, file, setCategory, setRegion, setFile } = useUploadForm();
  const multipart = useUpload();
  const tus = useTusUpload(region);
  const isVideo = category === "video";
  const busy = multipart.isPending || ["uploading", "paused", "waiting"].includes(tus.state.phase);
  const receipt = isVideo ? tus.state.receipt : multipart.data;

  const submit = () => {
    if (!file) return;
    if (isVideo) tus.start(file);
    else multipart.mutate({ file, category, region });
  };

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">Upload a record</h1>
      <p className="mt-3 max-w-xl text-muted">Every file is hashed on arrival, so you can prove later that what you download is what you sent.</p>
      <div className="mt-10 space-y-6">
        <CategoryPicker value={category} onChange={(c) => { setCategory(c); multipart.reset(); tus.reset(); }} />
        <label className="block max-w-xs text-sm">
          <span className="mb-1.5 block text-[13px] text-muted">Region</span>
          <select className={FIELD} value={region} onChange={(e) => setRegion(e.target.value as Region)}>
            {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <DropZone file={file} onFile={setFile} disabled={busy} />
        <PrimaryButton disabled={!file || busy} onClick={submit}>
          {multipart.isPending ? "Uploading…" : "Upload record"}
        </PrimaryButton>
        {multipart.isError && <p role="alert" className="text-sm text-bad">{multipart.error.message}</p>}
        {isVideo && tus.state.phase !== "idle" && <TusProgress state={tus.state} onToggle={tus.toggle} />}
        {isVideo && tus.state.phase === "done" && !receipt && <p className="text-sm text-good">{tus.state.message}</p>}
        {receipt && <ReceiptCard receipt={receipt} />}
      </div>
    </div>
  );
}
