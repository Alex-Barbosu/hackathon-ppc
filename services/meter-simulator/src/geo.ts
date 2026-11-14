// Service areas of the three Rețele Electrice distribution companies. Weights approximate
// each county's share of connected customers, so București dominates Muntenia and
// Constanța dominates Dobrogea, as in the real grid. Coordinates are county centres;
// `spreadDeg` scatters meters over roughly the county's extent.

export type Region = "muntenia" | "banat" | "dobrogea";

export interface County {
  name: string;
  region: Region;
  lat: number;
  lon: number;
  spreadDeg: number;
  weight: number;
}

/** Two-letter code used in meter ids (RO-MT-000123), matching the contract examples. */
export const REGION_CODE: Record<Region, string> = {
  muntenia: "MT",
  banat: "BN",
  dobrogea: "DB",
};

export const REGIONS: readonly Region[] = ["muntenia", "banat", "dobrogea"];

export const COUNTIES: readonly County[] = [
  // Muntenia (~45 % of customers)
  { name: "București", region: "muntenia", lat: 44.4268, lon: 26.1025, spreadDeg: 0.07, weight: 0.33 },
  { name: "Ilfov", region: "muntenia", lat: 44.535, lon: 26.18, spreadDeg: 0.18, weight: 0.08 },
  { name: "Giurgiu", region: "muntenia", lat: 44.08, lon: 25.88, spreadDeg: 0.25, weight: 0.04 },
  // Banat (~32 %)
  { name: "Timiș", region: "banat", lat: 45.75, lon: 21.3, spreadDeg: 0.35, weight: 0.12 },
  { name: "Arad", region: "banat", lat: 46.25, lon: 21.65, spreadDeg: 0.35, weight: 0.08 },
  { name: "Hunedoara", region: "banat", lat: 45.8, lon: 22.9, spreadDeg: 0.3, weight: 0.07 },
  { name: "Caraș-Severin", region: "banat", lat: 45.2, lon: 22.0, spreadDeg: 0.35, weight: 0.05 },
  // Dobrogea (~23 %)
  { name: "Constanța", region: "dobrogea", lat: 44.18, lon: 28.4, spreadDeg: 0.3, weight: 0.12 },
  { name: "Tulcea", region: "dobrogea", lat: 45.05, lon: 28.85, spreadDeg: 0.35, weight: 0.03 },
  { name: "Călărași", region: "dobrogea", lat: 44.3, lon: 27.0, spreadDeg: 0.3, weight: 0.04 },
  { name: "Ialomița", region: "dobrogea", lat: 44.6, lon: 27.4, spreadDeg: 0.3, weight: 0.04 },
];
