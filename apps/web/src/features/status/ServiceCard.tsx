import { useServiceHealth, type HealthState } from "./useServiceHealth";

const DOT: Record<HealthState, string> = {
  checking: "bg-line",
  up: "bg-good",
  down: "bg-bad",
};

interface ServiceCardProps {
  name: string;
  zone: string;
  url: string;
}

export function ServiceCard({ name, zone, url }: ServiceCardProps) {
  const state = useServiceHealth(url);
  return (
    <article className="rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl">{name}</p>
        <span className={`size-2.5 rounded-full ${DOT[state]}`} aria-label={state} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {zone} · <code className="text-xs">{url}</code>
      </p>
    </article>
  );
}
