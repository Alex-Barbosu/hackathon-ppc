import { ServiceCard } from "./ServiceCard";

const SERVICES = [
  { name: "FileGrid API", zone: "Zone A", url: "/api/v1/health" },
  { name: "Insights", zone: "Zone C", url: "/insights/health" },
  { name: "Chaos control", zone: "Zone B", url: "/chaos/state" },
  { name: "Mock API", zone: "Contracts", url: "/mock/api/v1/health" },
] as const;

export function StatusBoard() {
  return (
    <section className="mt-12 grid gap-4 sm:grid-cols-2">
      {SERVICES.map((s) => (
        <ServiceCard key={s.url} {...s} />
      ))}
      <a
        href="/grafana/"
        className="rounded-card border border-line bg-surface p-6 transition-colors hover:border-accent sm:col-span-2"
      >
        <p className="font-display text-xl">Grafana</p>
        <p className="mt-1 text-sm text-muted">Latency, throughput, errors and traces →</p>
      </a>
    </section>
  );
}
