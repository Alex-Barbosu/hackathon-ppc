import type { components } from "../api/schema";

export type Category = components["schemas"]["Category"];
export type Region = components["schemas"]["Region"];
export type County = components["schemas"]["County"];
export type ComtradeRecording = components["schemas"]["ComtradeRecording"];
export type Location = components["schemas"]["Location"];
export type FileReceipt = components["schemas"]["FileReceipt"];
export type FileMeta = components["schemas"]["FileMeta"];

// Meter readings arrive from devices, never from the UI.
export type UploadCategory = Extract<Category, "outage" | "document" | "video">;

export const UPLOAD_CATEGORIES: ReadonlyArray<{ id: UploadCategory; label: string; hint: string }> = [
  { id: "outage", label: "Outage record", hint: "Substation records, up to 10 MB" },
  { id: "document", label: "Document", hint: "Customer connection files, encrypted at rest" },
  { id: "video", label: "Drone video", hint: "Large files, resumable on weak links" },
];

export const REGIONS: ReadonlyArray<{ id: Region; label: string }> = [
  { id: "muntenia", label: "Muntenia" },
  { id: "banat", label: "Banat" },
  { id: "dobrogea", label: "Dobrogea" },
];

// The contract's County enum with its region. Same order as the meter simulator: largest county first.
export const COUNTIES: ReadonlyArray<{ id: County; region: Region }> = [
  { id: "București", region: "muntenia" }, { id: "Ilfov", region: "muntenia" }, { id: "Giurgiu", region: "muntenia" },
  { id: "Timiș", region: "banat" }, { id: "Arad", region: "banat" }, { id: "Hunedoara", region: "banat" },
  { id: "Caraș-Severin", region: "banat" }, { id: "Constanța", region: "dobrogea" }, { id: "Tulcea", region: "dobrogea" },
  { id: "Călărași", region: "dobrogea" }, { id: "Ialomița", region: "dobrogea" },
];

export const countiesIn = (region: Region): County[] => COUNTIES.filter((c) => c.region === region).map((c) => c.id);

export type Storage = components["schemas"]["Storage"];
export type LabRun = components["schemas"]["StorageLabRun"];
export type LabCell = components["schemas"]["StorageLabCell"];
export type LabRecommendation = NonNullable<LabRun["recommendation"]>[number];
export type Policy = components["schemas"]["Policy"];
export type Incident = components["schemas"]["Incident"];
export type Briefing = components["schemas"]["Briefing"];
export type Anomaly = components["schemas"]["Anomaly"];
export type Hotspot = components["schemas"]["Hotspot"];
export type AnalystEvent = components["schemas"]["AnalystEvent"];
export type SourceChip = NonNullable<AnalystEvent["sources"]>[number];
