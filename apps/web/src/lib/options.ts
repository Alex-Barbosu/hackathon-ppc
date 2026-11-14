import type { SelectOption } from "../components/select/Select";
import { COUNTIES, REGIONS, UPLOAD_CATEGORIES, type Category, type County, type Region } from "./domain";

const REGION_LABEL = new Map(REGIONS.map((r) => [r.id, r.label]));

export const REGION_OPTIONS: SelectOption<Region>[] = REGIONS.map((r) => ({
  value: r.id, label: r.label, hint: `${COUNTIES.filter((c) => c.region === r.id).length} counties`,
}));

// Counties grouped under their region heading, so the list explains the geography by itself.
export function countyOptions(region: Region | ""): SelectOption<County>[] {
  return COUNTIES.filter((c) => !region || c.region === region).map((c) => ({ value: c.id, label: c.id, group: REGION_LABEL.get(c.region) }));
}

export const CATEGORY_OPTIONS: SelectOption<Category>[] = [
  ...UPLOAD_CATEGORIES.map((c) => ({ value: c.id as Category, label: c.label, hint: c.hint })),
  { value: "meter", label: "Meter reading", hint: "Sent by meters, not uploaded" },
];

export const withAll = <T extends string>(label: string, options: SelectOption<T>[]): SelectOption<T | "">[] => [
  { value: "", label }, ...options.map((o) => ({ ...o })),
];
