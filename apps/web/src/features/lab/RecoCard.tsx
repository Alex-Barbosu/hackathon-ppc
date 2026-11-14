import type { LabRecommendation, Storage } from "../../lib/domain";
import { STORAGE_NAME } from "./constants";

const LABEL: Record<string, string> = { meter: "Meter readings", outage: "Outage records", document: "Documents", video: "Drone video" };

export function RecoCard({ rec, current }: { rec: LabRecommendation; current: Storage | undefined }) {
  const changes = current !== undefined && current !== rec.storage;
  return (
    <article className="rounded-card border-[0.8px] border-line bg-surface p-6 sm:p-8">
      <p className="label text-faint">{LABEL[rec.category]}</p>
      <h3 className="mt-3 font-display text-4xl text-white/80">{STORAGE_NAME[rec.storage]}</h3>
      <p className={`mt-1 text-[13px] ${changes ? "text-warn" : "text-good"}`}>
        {current === undefined ? "Current policy unknown" : changes ? `Change from ${STORAGE_NAME[current]}` : "Matches the current policy"}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {(rec.reasons ?? [rec.reason]).map((r) => <li key={r} className="border-l-[1.5px] border-white/30 pl-3 text-base text-white/85">{r}</li>)}
      </ul>
      {rec.evidence && rec.evidence.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Numbers used">
          {rec.evidence.map((e) => (
            <li key={e.label} className="rounded-md border-[0.8px] border-line px-2.5 py-1 text-[13px] tabular-nums">
              <span className="text-muted">{e.label}</span> {e.value}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
