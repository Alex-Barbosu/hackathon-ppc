import { PageHero } from "../../components/PageHero";
import { Arrow, CARD, PrimaryButton } from "../../components/ui";
import { CategoryPicker } from "./CategoryPicker";
import { DropZone } from "./DropZone";
import { HowItWorks } from "./HowItWorks";
import { PlaceFields } from "./PlaceFields";
import { ReceiptCard } from "./ReceiptCard";
import { TusProgress } from "./TusProgress";
import { UploadPhone } from "./UploadPhone";
import { useTusUpload } from "./useTusUpload";
import { useUpload } from "./useUpload";
import { useUploadForm } from "./useUploadForm";

export function UploadPage() {
  const { category, region, county, file, setCategory, setFile } = useUploadForm();
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
      <PageHero label="Upload" title={<>Upload a <em>record</em>.</>}>
        Every file is hashed on arrival, so you can prove later that what you download is what you sent.
      </PageHero>
      <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Upload form" className={`${CARD} space-y-8 p-5 sm:p-10`}>
          <CategoryPicker value={category} onChange={(c) => { setCategory(c); multipart.reset(); tus.reset(); }} />
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
        <UploadPhone file={file} receipt={receipt ?? null} pending={busy} percent={isVideo ? tus.state.percent : null} />
      </div>
      <div className="mt-24"><HowItWorks /></div>
    </>
  );
}
