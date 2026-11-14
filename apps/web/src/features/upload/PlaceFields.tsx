import { Select } from "../../components/select/Select";
import type { County } from "../../lib/domain";
import { REGION_OPTIONS, countyOptions, withAll } from "../../lib/options";
import { useUploadForm } from "./useUploadForm";

// Region for every upload; county only for outage records, where it places the outage on the hotspot map.
export function PlaceFields({ withCounty }: { withCounty: boolean }) {
  const { region, county, setRegion, setCounty } = useUploadForm();
  return (
    <div className="grid max-w-xl gap-4 sm:grid-cols-2">
      <Select label="Region" value={region} options={REGION_OPTIONS} onChange={setRegion} />
      {withCounty && (
        <Select label="County of the outage" value={county ?? ""} options={withAll("Not specified", countyOptions(region))}
          onChange={(v) => setCounty(v ? (v as County) : null)} />
      )}
    </div>
  );
}
