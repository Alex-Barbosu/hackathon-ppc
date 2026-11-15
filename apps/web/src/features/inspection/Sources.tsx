import { InspectionLayout } from "./InspectionLayout";
import type { InspectionMedia } from "./media";
import { useInspectionPlayer } from "./useInspectionPlayer";
import { useVideoPlayer } from "./useVideoPlayer";

// Two interchangeable sources behind one layout: the rendered 3D flight (always available) and a
// supplied clip with hand-keyframed boxes. Each calls its own hook, so neither is conditional.
export function RenderedInspection({ media }: { media: InspectionMedia | null }) {
  const p = useInspectionPlayer();
  return (
    <InspectionLayout p={p} stills={media?.stills}>
      <canvas ref={p.gl} className="absolute inset-0 size-full [filter:saturate(0.82)_contrast(1.06)]" />
      <canvas ref={p.overlay} className="pointer-events-none absolute inset-0 size-full" />
    </InspectionLayout>
  );
}

export function VideoInspection({ media }: { media: InspectionMedia }) {
  const p = useVideoPlayer(media);
  return (
    <InspectionLayout p={p} stills={media.stills}>
      <video ref={p.video} src={`/inspection/${media.video}`} autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover" />
      <canvas ref={p.overlay} className="pointer-events-none absolute inset-0 size-full" />
    </InspectionLayout>
  );
}
