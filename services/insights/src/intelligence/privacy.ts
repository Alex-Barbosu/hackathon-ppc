// CLAUDE.md rule 8: no document content, names or ID numbers in any external API call. Everything
// that reaches the model passes through here first, and only metric-shaped facts get through.

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const FILE = /\b[\w.-]+\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|mp4|mov|avi|bin|csv|json|xml|cfg|dat|zip|txt)\b/gi;
const LONG_NUMBER = /\b\d{9,}\b/g; // phone numbers and national ID numbers (13 digits); real counters are far smaller
const TOKEN = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;

export function scrub(text: string): string {
  return text.replace(TOKEN, "[token]").replace(UUID, "[id]").replace(EMAIL, "[email]").replace(FILE, "[file]").replace(LONG_NUMBER, "[number]");
}

// Alert labels come from our own rules, but the webhook is just JSON: allowlist keys and shapes.
const SAFE_LABEL_KEYS = ["alertname", "severity", "category", "guarantee", "storage", "region", "op", "outcome"];
const SAFE_VALUE = /^[A-Za-z0-9_.:-]{1,48}$/;

export interface AlertInput {
  alertname: string;
  status: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
}
export interface AlertFacts {
  alert: string;
  status: string;
  startedAt: string;
  labels: Record<string, string>;
  summary: string;
  description: string;
}

export function alertFacts(a: AlertInput): AlertFacts {
  const labels = Object.fromEntries(
    SAFE_LABEL_KEYS.flatMap((k) => (a.labels[k] !== undefined && SAFE_VALUE.test(a.labels[k]) ? [[k, a.labels[k]]] : [])),
  );
  return {
    alert: SAFE_VALUE.test(a.alertname) ? a.alertname : "UnknownAlert",
    status: a.status,
    startedAt: a.startsAt,
    labels,
    summary: scrub(a.annotations.summary ?? "").slice(0, 200),
    description: scrub(a.annotations.description ?? "").slice(0, 300),
  };
}

export const CATEGORIES = ["meter", "outage", "document", "video"] as const;
export const STORAGES = ["db", "s3", "ftp"] as const;
export const isCategory = (v: string | undefined): v is (typeof CATEGORIES)[number] => CATEGORIES.some((c) => c === v);
export const isStorage = (v: string | undefined): v is (typeof STORAGES)[number] => STORAGES.some((s) => s === v);
