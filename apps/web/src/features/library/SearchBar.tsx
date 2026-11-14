import { FIELD, SecondaryButton } from "../../components/ui";
import { REGIONS, UPLOAD_CATEGORIES, type Category, type Region } from "../../lib/domain";
import { useFilters } from "./useFileSearch";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[13px] text-muted">{label}</span>
      {children}
    </label>
  );
}

export function SearchBar() {
  const { filters, set, clear } = useFilters();
  return (
    <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()}>
      <div className="sm:col-span-2">
        <Field label="Search name or description">
          <input className={FIELD} type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="e.g. Ploiești" />
        </Field>
      </div>
      <Field label="Category">
        <select className={FIELD} value={filters.category} onChange={(e) => set({ category: e.target.value as Category | "" })}>
          <option value="">All</option>
          {UPLOAD_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          <option value="meter">Meter reading</option>
        </select>
      </Field>
      <Field label="Region">
        <select className={FIELD} value={filters.region} onChange={(e) => set({ region: e.target.value as Region | "" })}>
          <option value="">All</option>
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="From"><input className={FIELD} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></Field>
      <Field label="To"><input className={FIELD} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></Field>
      <div className="sm:col-span-2 lg:col-span-6">
        <SecondaryButton onClick={clear}>Clear filters</SecondaryButton>
      </div>
    </form>
  );
}
