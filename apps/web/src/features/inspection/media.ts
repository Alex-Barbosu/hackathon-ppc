import { useQuery } from "@tanstack/react-query";

/** [seconds, x, y, w, h], position and size as fractions of the frame. */
export type Keyframe = [number, number, number, number, number];

/**
 * Optional real footage in public/inspection/. Without manifest.json the page plays the rendered flight.
 * Boxes on a real clip are keyframed by hand, so they follow the objects only as well as they were placed.
 */
export interface InspectionMedia {
  video?: string;
  tracks?: Record<string, Keyframe[]>;
  stills?: Record<string, { src: string; box: [number, number, number, number]; at?: number; zoom?: number }>;
}

// The SPA fallback answers a missing file with index.html and a 200, so anything that is not JSON means "none".
async function loadMedia(): Promise<InspectionMedia | null> {
  const res = await fetch("/inspection/manifest.json", { cache: "no-cache" });
  if (!res.ok) return null;
  try { return (await res.json()) as InspectionMedia; } catch { return null; }
}

export function useInspectionMedia() {
  return useQuery({ queryKey: ["inspection-media"], queryFn: loadMedia, staleTime: Infinity, retry: false });
}

/** Linear interpolation between keyframes; null outside the first and last keyframe. */
export function boxAt(track: Keyframe[], sec: number): [number, number, number, number] | null {
  const first = track[0], last = track[track.length - 1];
  if (!first || !last || sec < first[0] || sec > last[0]) return null;
  const i = Math.max(0, track.findIndex((k) => k[0] > sec) - 1);
  const a = track[i]!, b = track[i + 1] ?? a;
  const t = b[0] === a[0] ? 0 : (sec - a[0]) / (b[0] - a[0]);
  return [1, 2, 3, 4].map((j) => a[j]! + (b[j]! - a[j]!) * t) as [number, number, number, number];
}
