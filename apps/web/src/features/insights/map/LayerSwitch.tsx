import type { MapLayer } from "./MapCanvas";

const LAYERS: ReadonlyArray<{ id: MapLayer; label: string }> = [{ id: "outages", label: "Outages" }, { id: "meters", label: "Meter anomalies" }];

// Two questions, one map: where the grid failed, and where the meters say something is wrong.
export function LayerSwitch({ value, onChange }: { value: MapLayer; onChange: (l: MapLayer) => void }) {
  return (
    <div role="radiogroup" aria-label="Map layer" className="flex rounded-lg bg-white/6 p-0.5">
      {LAYERS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={value === l.id} onClick={() => onChange(l.id)}
          className={`rounded-md px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${value === l.id ? "bg-white text-black" : "text-muted hover:text-ink"}`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
