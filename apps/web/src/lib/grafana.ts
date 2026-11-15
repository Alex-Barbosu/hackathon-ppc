// Grafana sits behind the same gateway at /grafana, with anonymous viewing and embedding on (infra/compose.yml).
export const GRAFANA_HOME = "/grafana/";

export const DASHBOARDS = [
  { uid: "filegrid-overview", label: "Overview" },
  { uid: "filegrid-storages", label: "Storages" },
  { uid: "filegrid-storm", label: "Storm" },
  { uid: "filegrid-meters", label: "Meters" },
] as const;

export const dashboardUrl = (uid: string, kiosk = false) => `/grafana/d/${uid}/?orgId=1&refresh=5s&theme=dark${kiosk ? "&kiosk" : ""}`;

/** Opens one request's trace in Grafana Explore (Tempo): the brief's "one operation, request to storage". */
export function traceUrl(traceId: string): string {
  const panes = { a: { datasource: "tempo", queries: [{ refId: "A", datasource: { type: "tempo", uid: "tempo" }, queryType: "traceql", query: traceId }], range: { from: "now-6h", to: "now" } } };
  return `/grafana/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
