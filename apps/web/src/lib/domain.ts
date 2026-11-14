import type { components } from "../api/schema";

export type Category = components["schemas"]["Category"];
export type Region = components["schemas"]["Region"];
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
