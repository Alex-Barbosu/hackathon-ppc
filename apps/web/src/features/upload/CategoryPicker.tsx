import { UPLOAD_CATEGORIES, type UploadCategory } from "../../lib/domain";

interface CategoryPickerProps {
  value: UploadCategory;
  onChange: (value: UploadCategory) => void;
}

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
            className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"
            }`}
          >
            <p className="font-medium">{c.label}</p>
            <p className="mt-1 text-[13px] text-muted">{c.hint}</p>
          </button>
        );
      })}
    </div>
  );
}
