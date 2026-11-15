import type { Finding } from "./findings";
import type { InspectionMedia } from "./media";

const TONE = { high: "border-bad", medium: "border-warn", review: "border-white/80" } as const;

type Still = NonNullable<InspectionMedia["stills"]>[string];

// The close-up frame the finding was raised on, with the detection box at the same place.
export function EvidenceStill({ f, still }: { f: Finding; still: Still }) {
  const [x, y, w, h] = still.box;
  return (
    <figure className="relative mt-3 overflow-hidden rounded-lg border-[0.8px] border-line">
      <img src={`/inspection/${still.src}`} alt={`Close-up frame for ${f.id}`} className="block h-auto w-full" />
      <span aria-hidden className={`absolute border-[1.5px] ${TONE[f.severity]}`}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
      <figcaption className="absolute inset-x-0 bottom-0 flex justify-between bg-black/70 px-2.5 py-1.5 font-mono text-[11px] text-white/85">
        <span>{f.id} close-up</span><span>{f.confidence.toFixed(2)}</span>
      </figcaption>
    </figure>
  );
}
