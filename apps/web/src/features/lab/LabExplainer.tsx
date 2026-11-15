// The Lab's recommendation is only trustworthy if a reader can see how it was reached, so the
// method is on the page in four plain steps, mirroring services/insights/src/storageLab.
const STEPS = [
  { title: "Upload to every storage", body: "The same sample file is uploaded to PostgreSQL, S3 and FTPS, with the policy bypassed so each storage is tested directly." },
  { title: "Download and prove it", body: "Each file is downloaded again and its SHA-256 compared. Any error or mismatch rules that storage out for the category." },
  { title: "Score the speed", body: "Save time counts 40%, read time 20% and upload speed 40%, each relative to the best storage. Times are the 95% mark: 95 of 100 uploads were at least this fast." },
  { title: "Add what speed cannot show", body: "Documents get a bonus on FTPS (separate audited store) and video on S3 (resumable). Every storage must keep at least one category, as the brief requires." },
] as const;

export function LabExplainer() {
  return (
    <section aria-label="How the Lab decides" className="grid gap-px overflow-hidden rounded-card border-[0.8px] border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
      {STEPS.map((s, i) => (
        <div key={s.title} className="bg-canvas p-6">
          <p className="label text-faint">Step 0{i + 1}</p>
          <h3 className="mt-3 text-base font-normal text-white">{s.title}</h3>
          <p className="mt-2 text-sm leading-[1.55] text-muted">{s.body}</p>
        </div>
      ))}
    </section>
  );
}
