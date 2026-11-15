import { Chip, WIDGET } from "../../components/ui";
import type { Window } from "../../three/inspectionScene";
import { EvidenceStill } from "./EvidenceStill";
import { FINDINGS, KIND_LABEL, type Severity } from "./findings";
import type { InspectionMedia } from "./media";
import { timecode } from "./timecode";

const SEVERITY: Record<Severity, { tone: "bad" | "warn" | "neutral"; word: string }> = {
  high: { tone: "bad", word: "High" }, medium: { tone: "warn", word: "Medium" }, review: { tone: "neutral", word: "Needs review" },
};

interface FindingsListProps { windows: Window[]; selected: string | null; onFocus: (id: string) => void; stills: InspectionMedia["stills"] }

// One row per detection, tied to a span or tower; clicking a row seeks the footage to it.
export function FindingsList({ windows, selected, onFocus, stills }: FindingsListProps) {
  return (
    <ol className={`${WIDGET} divide-y-[0.8px] divide-line`}>
      {FINDINGS.map((f) => {
        const w = windows.find((x) => x.id === f.id);
        const s = SEVERITY[f.severity];
        return (
          <li key={f.id}>
            <button type="button" onClick={() => onFocus(f.id)} aria-current={selected === f.id}
              className={`w-full px-4 py-3 text-left transition-colors hover:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${selected === f.id ? "bg-white/6" : ""}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-normal">{KIND_LABEL[f.kind]}</span>
                <Chip tone={s.tone}>{s.word}</Chip>
              </div>
              <div className="mt-1 flex justify-between gap-3 font-mono text-xs tabular-nums text-muted">
                <span>{f.span}</span>
                <span>{w ? timecode(w.best) : "—"} · {f.confidence.toFixed(2)}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-faint">{f.detail}</p>
              {selected === f.id && stills?.[f.id] && <EvidenceStill f={f} still={stills[f.id]!} />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
