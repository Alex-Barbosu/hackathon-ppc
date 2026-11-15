import { TEX_CLASS, type TextureName } from "../../components/Texture";
import { UPLOAD_CATEGORIES, type UploadCategory } from "../../lib/domain";

interface CategoryPickerProps {
  value: UploadCategory;
  allowed: readonly UploadCategory[];
  onChange: (value: UploadCategory) => void;
}

// Each category gets its own landscape, like Origin's image cards, so the choice reads at a glance.
const TEX: Record<UploadCategory, TextureName> = { outage: "lines-dusk", document: "sky", video: "forest" };

export function CategoryPicker({ value, allowed, onChange }: CategoryPickerProps) {
  return (
    <div role="radiogroup" aria-label="Category" className={`grid gap-3 ${allowed.length > 1 ? "sm:grid-cols-3" : "sm:max-w-sm"}`}>
      {UPLOAD_CATEGORIES.filter((c) => allowed.includes(c.id)).map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.id)}
            className={`group flex flex-col overflow-hidden rounded-widget border-[0.8px] bg-panel text-left transition-[border-color,transform] duration-300 active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active ? "border-white" : "border-line hover:border-white/30"
            }`}
          >
            <span className="relative flex h-24 w-full shrink-0 items-end overflow-hidden p-3">
              <span aria-hidden className={`absolute inset-0 transition-transform duration-[1200ms] ease-out group-hover:scale-110 ${active ? "scale-105" : ""} ${TEX_CLASS[TEX[c.id]]}`} />
              <span className={`label relative rounded-md px-2 py-1 transition-colors duration-300 ${active ? "bg-white text-black" : "bg-black/45 text-white"}`}>{active ? "Selected" : c.id}</span>
            </span>
            <span className="block p-4">
              <span className="block text-base font-normal">{c.label}</span>
              <span className="mt-1 block text-[13px] text-faint">{c.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
