import { FIELD, SecondaryButton } from "../../components/ui";
import { Select } from "../../components/select/Select";
import { CATEGORY_OPTIONS, REGION_OPTIONS, countyOptions, withAll } from "../../lib/options";
import { useAccess } from "../../state/useAccess";
import { useFilters } from "./useFileSearch";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="caption mb-2 block text-muted">{label}</span>
      {children}
    </label>
  );
}

export function SearchBar() {
  const { filters, set, clear } = useFilters();
  const { library } = useAccess();
  const categories = CATEGORY_OPTIONS.filter((o) => library.includes(o.value));
  return (
    <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7" onSubmit={(e) => e.preventDefault()}>
      <div className="sm:col-span-2">
        <Field label="Search name or description">
          <input className={FIELD} type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="e.g. Ploiești" />
        </Field>
      </div>
      {categories.length > 1 && <Select label="Category" value={filters.category} options={withAll("All categories", categories)} onChange={(v) => set({ category: v })} />}
      <Select label="Region" value={filters.region} options={withAll("All regions", REGION_OPTIONS)} onChange={(v) => set({ region: v, county: "" })} />
      <Select label="County" value={filters.county} options={withAll("All counties", countyOptions(filters.region))} onChange={(v) => set({ county: v })} />
      <Field label="From"><input className={FIELD} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></Field>
      <Field label="To"><input className={FIELD} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></Field>
      <div className="sm:col-span-2 lg:col-span-7">
        <SecondaryButton onClick={clear}>Clear filters</SecondaryButton>
      </div>
    </form>
  );
}
