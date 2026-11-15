import type { Policy } from "../../lib/domain.ts";

export interface FieldChange { category: string; field: string; from: string; to: string }

const CATEGORIES = ["meter", "outage", "document", "video"] as const;
const show = (v: unknown): string => (v === undefined || v === null ? "–" : String(v));

/** Every setting that differs between two policies, category by category, in a stable order. */
export function diffPolicies(from: Policy, to: Policy): FieldChange[] {
  const out: FieldChange[] = [];
  for (const category of CATEGORIES) {
    const a: Record<string, unknown> = { ...from.categories[category] };
    const b: Record<string, unknown> = { ...to.categories[category] };
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (show(a[field]) !== show(b[field])) out.push({ category, field, from: show(a[field]), to: show(b[field]) });
    }
  }
  return out;
}

/**
 * The body for a rollback PUT. History rows come back with optional settings as null, and the
 * server's schema refuses unknown or null keys, so absent settings are dropped rather than sent.
 */
export function rollbackBody(p: Policy): Policy {
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;
  return {
    version: p.version,
    categories: {
      meter: clean(p.categories.meter), outage: clean(p.categories.outage),
      document: clean(p.categories.document), video: clean(p.categories.video),
    },
  };
}
