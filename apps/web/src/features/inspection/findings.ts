// Detections for the preview flight. Nothing here comes from a trained model: the boxes are anchored to
// objects in the rendered scene, so they track the footage the way a real detector's output would.
// When a real model exists, its output replaces this list and the player stays as it is.

export type DefectKind = "vegetation" | "insulator" | "sag";
export type Severity = "high" | "medium" | "review";

/** Where the defect sits in the scene: on a conductor attach point, part-way along a span, or beside one. */
export type Anchor =
  | { at: "attach"; tower: number; attach: number; radius: number }
  | { at: "span"; tower: number; attach: number; t: number; radius: number }
  | { at: "beside"; tower: number; t: number; side: number; height: number; radius: number };

export interface Finding {
  id: string;
  kind: DefectKind;
  severity: Severity;
  confidence: number;
  span: string;
  detail: string;
  anchor: Anchor;
}

export const KIND_LABEL: Record<DefectKind, string> = {
  vegetation: "Vegetation near line",
  insulator: "Damaged insulator",
  sag: "Sagging conductor",
};

export const FLIGHT = {
  line: "LEA 110 kV Brazi Vest – Băicoi",
  section: "T-112 to T-118",
  region: "Muntenia",
  // A real stretch of open country between Brazi and Băicoi (Prahova), where 110 kV lines cross farmland.
  site: { name: "Brazi – Băicoi, Prahova", lat: 44.9519, lon: 25.9283 },
  flown: "12 Nov 2026, 10:42",
  file: "insp-brazi-baicoi-t112-t118.mp4",
  durationSec: 42,
  model: "linescan-v0.3 (in testing)",
};

/** Tower index in the scene to the operator's tower number. */
export const towerId = (i: number) => `T-${112 + i}`;
const spanId = (i: number) => `${towerId(i)} – ${towerId(i + 1)}`;

export const FINDINGS: Finding[] = [
  {
    id: "F-01", kind: "vegetation", severity: "high", confidence: 0.91, span: spanId(1),
    detail: "Tree crowns 2.1 m below lower phase L1; minimum clearance is 3.0 m",
    anchor: { at: "beside", tower: 1, t: 0.55, side: 8.5, height: 10, radius: 6.5 },
  },
  {
    id: "F-02", kind: "vegetation", severity: "review", confidence: 0.64, span: spanId(2),
    detail: "Young growth under the span, clearance within limits; check next season",
    anchor: { at: "beside", tower: 2, t: 0.3, side: -9, height: 6, radius: 5 },
  },
  {
    id: "F-03", kind: "insulator", severity: "high", confidence: 0.87, span: towerId(3),
    detail: "Lower string, phase L1: two broken sheds, flashover marks on the cap",
    anchor: { at: "attach", tower: 3, attach: 0, radius: 2.4 },
  },
  {
    id: "F-04", kind: "sag", severity: "medium", confidence: 0.78, span: spanId(4),
    detail: "Phase L3 sits 1.3 m below its design profile at mid-span",
    anchor: { at: "span", tower: 4, attach: 2, t: 0.5, radius: 3.2 },
  },
  {
    id: "F-05", kind: "insulator", severity: "review", confidence: 0.58, span: towerId(5),
    detail: "Lower string: possible contamination on the glass discs; image too oblique to confirm",
    anchor: { at: "attach", tower: 5, attach: 4, radius: 2.2 },
  },
];
