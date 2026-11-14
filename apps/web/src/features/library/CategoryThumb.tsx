import { TEX_CLASS, type TextureName } from "../../components/Texture";
import type { Category } from "../../lib/domain";

const TEX: Record<Category, TextureName> = { outage: "amber", document: "sky", video: "forest", meter: "field" };
const SHORT: Record<Category, string> = { outage: "OUT", document: "DOC", video: "VID", meter: "MTR" };

// A small landscape tile per category, so a long list can be scanned by colour before reading.
export function CategoryThumb({ category }: { category: Category }) {
  return (
    <span aria-hidden className={`label flex size-12 shrink-0 items-end rounded-[10px] p-1.5 text-[10px] text-white ${TEX_CLASS[TEX[category]]}`}>
      <span className="rounded bg-black/45 px-1">{SHORT[category]}</span>
    </span>
  );
}
