import type { LabRecommendation, Storage } from "../../lib/domain";
import { STORAGE_NAME } from "./constants";

const LABEL: Record<string, string> = { meter: "Meter readings", outage: "Outage records", document: "Documents", video: "Drone video" };

export function RecoCard({ rec, current }: { rec: LabRecommendation; current: Storage | undefined }) {
  const changes = current !== undefined && current !== rec.storage;
  return (
    <article className="rounded-card border border-line bg-surface p-6">
      <p className="text-[13px] text-muted">{LABEL[rec.category]}</p>
      <h3 className="mt-1 font-display text-2xl">{STORAGE_NAME[rec.storage]}</h3>
      <p className={`mt-1 text-[13px] ${changes ? "text-warn" : "text-good"}`}>
        {current === undefined ? "Current policy unknown" : changes ? `Change from ${STORAGE_NAME[current]}` : "Matches the current policy"}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {(rec.reasons ?? [rec.reason]).map((r) => <li key={r} className="border-l-2 border-accent/40 pl-3">{r}</li>)}
      </ul>
      {rec.evidence && rec.evidence.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Numbers used">
          {rec.evidence.map((e) => (
            <li key={e.label} className="rounded-full border border-line px-3 py-1 text-[13px] tabular-nums">
              <span className="text-muted">{e.label}</span> {e.value}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
