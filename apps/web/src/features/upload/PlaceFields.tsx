import { FIELD } from "../../components/ui";
import { REGIONS, countiesIn, type County, type Region } from "../../lib/domain";
import { useUploadForm } from "./useUploadForm";

// Region for every upload; county only for outage records, where it places the outage on the hotspot map.
export function PlaceFields({ withCounty }: { withCounty: boolean }) {
  const { region, county, setRegion, setCounty } = useUploadForm();
  return (
    <div className="flex max-w-xl flex-col gap-4 sm:flex-row">
      <label className="block flex-1 text-sm">
        <span className="mb-1.5 block text-[13px] text-muted">Region</span>
        <select className={FIELD} value={region} onChange={(e) => setRegion(e.target.value as Region)}>
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      {withCounty && (
        <label className="block flex-1 text-sm">
          <span className="mb-1.5 block text-[13px] text-muted">County of the outage</span>
          <select className={FIELD} value={county ?? ""} onChange={(e) => setCounty(e.target.value ? (e.target.value as County) : null)}>
            <option value="">Not specified</option>
            {countiesIn(region).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
