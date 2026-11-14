export type Row = Record<string, unknown>;
/** The one thing the intelligence layer needs from pg, so tests can pass canned rows. */
export interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> }

export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
export const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
export const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v));
