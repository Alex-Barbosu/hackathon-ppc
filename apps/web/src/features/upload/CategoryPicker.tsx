import { UPLOAD_CATEGORIES, type UploadCategory } from "../../lib/domain";

interface CategoryPickerProps {
  value: UploadCategory;
  allowed: readonly UploadCategory[];
  onChange: (value: UploadCategory) => void;
}

// A segmented control: operators know the categories, so a name and one line are enough.
export function CategoryPicker({ value, allowed, onChange }: CategoryPickerProps) {
  return (
    <div role="radiogroup" aria-label="Category" className={`grid gap-2 ${allowed.length > 1 ? "sm:grid-cols-3" : "sm:max-w-sm"}`}>
      {UPLOAD_CATEGORIES.filter((c) => allowed.includes(c.id)).map((c) => {
        const active = c.id === value;
        return (
          <button key={c.id} type="button" role="radio" aria-checked={active} onClick={() => onChange(c.id)}
            className={`rounded-lg border-[0.8px] px-4 py-3 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active ? "border-white bg-white/8" : "border-line bg-panel hover:border-white/30"}`}>
            <span className="flex items-center justify-between gap-3 text-[15px] font-normal">
              {c.label}
              <span aria-hidden className={`size-2 rounded-full border ${active ? "border-white bg-white" : "border-white/30"}`} />
            </span>
            <span className="mt-0.5 block text-[13px] text-faint">{c.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
