import { TEX_CLASS, type TextureName } from "../../components/Texture";
import { UPLOAD_CATEGORIES, type UploadCategory } from "../../lib/domain";

interface CategoryPickerProps {
  value: UploadCategory;
  onChange: (value: UploadCategory) => void;
}

// Each category gets its own landscape, like Origin's image cards, so the choice reads at a glance.
const TEX: Record<UploadCategory, TextureName> = { outage: "amber", document: "sky", video: "forest" };

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  return (
    <div role="radiogroup" aria-label="Category" className="grid gap-3 sm:grid-cols-3">
      {UPLOAD_CATEGORIES.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.id)}
            className={`group flex flex-col overflow-hidden rounded-widget border-[0.8px] bg-panel text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active ? "border-white" : "border-line hover:border-white/30"
            }`}
          >
            <span className={`flex h-20 w-full shrink-0 items-end p-3 ${TEX_CLASS[TEX[c.id]]}`}>
              <span className={`label rounded-md px-2 py-1 ${active ? "bg-white text-black" : "bg-black/45 text-white"}`}>{active ? "Selected" : c.id}</span>
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
