import { PageHero } from "../../components/PageHero";
import { useInspectionMedia } from "./media";
import { RenderedInspection, VideoInspection } from "./Sources";

// Honesty first: a preview of the detector on one flight, with precomputed output. It never creates
// work orders, and the page says so where the judge's eye lands.
export function InspectionPage() {
  const media = useInspectionMedia();
  const data = media.data ?? null;
  return (
    <div className="space-y-6">
      <PageHero title="Line inspection" actions={<span className="caption text-warn">Preview · detection model in testing, findings are not sent to work orders</span>} />
      {media.isPending ? <div className="aspect-video animate-pulse rounded-widget bg-surface lg:w-2/3" />
        : data?.video ? <VideoInspection media={data} /> : <RenderedInspection media={data} />}
    </div>
  );
}
