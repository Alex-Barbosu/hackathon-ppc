import { useAccess } from "../../state/useAccess";
import { PageHero } from "../../components/PageHero";
import { Arrow, CARD, PrimaryButton } from "../../components/ui";
import { CategoryPicker } from "./CategoryPicker";
import { DropZone } from "./DropZone";
import { PlaceFields } from "./PlaceFields";
import { ReceiptCard } from "./ReceiptCard";
import { TusProgress } from "./TusProgress";
import { UploadFacts } from "./UploadFacts";
import { useTusUpload } from "./useTusUpload";
import { useUpload } from "./useUpload";
import { useUploadForm } from "./useUploadForm";

export function UploadPage() {
  const { category: picked, region, county, file, setCategory, setFile } = useUploadForm();
  const { upload: allowed } = useAccess();
  // The form remembers the last pick across sign-ins; a role that may not upload it gets its own category.
  const category = allowed.includes(picked) ? picked : (allowed[0] ?? picked);
  const multipart = useUpload();
  const tus = useTusUpload(region);
  const isVideo = category === "video";
  const busy = multipart.isPending || ["uploading", "paused", "waiting"].includes(tus.state.phase);
  const receipt = isVideo ? tus.state.receipt : multipart.data;

  const submit = () => {
    if (!file) return;
    if (isVideo) tus.start(file);
    else multipart.mutate({ file, category, region, county: category === "outage" ? county : null });
  };

  return (
    <>
      <PageHero label="Upload" title="Upload">
        Hashed on arrival, routed by the category policy, receipt returned with SHA-256 and trace ID.
      </PageHero>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Upload form" className={`${CARD} space-y-6 p-5 sm:p-8`}>
          <CategoryPicker value={category} allowed={allowed} onChange={(c) => { setCategory(c); multipart.reset(); tus.reset(); }} />
          <PlaceFields withCounty={category === "outage"} />
          <DropZone file={file} onFile={setFile} disabled={busy} />
          <PrimaryButton disabled={!file || busy} onClick={submit}>
            {multipart.isPending ? "Uploading…" : <>Upload record <Arrow /></>}
          </PrimaryButton>
          {multipart.isError && <p role="alert" className="text-sm text-bad">{multipart.error.message}</p>}
          {isVideo && tus.state.phase !== "idle" && <TusProgress state={tus.state} onToggle={tus.toggle} />}
          {isVideo && tus.state.phase === "done" && !receipt && <p className="text-sm text-good">{tus.state.message}</p>}
          {receipt && <ReceiptCard receipt={receipt} />}
        </section>
        <UploadFacts category={category} />
      </div>
    </>
  );
}
