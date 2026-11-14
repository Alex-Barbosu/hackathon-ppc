export interface Column<T> { header: string; value: (row: T) => string | number | boolean | null | undefined }

// RFC 4180 quoting, plus a guard against spreadsheet formula injection: a cell that starts with
// = + - @ is prefixed with an apostrophe so Excel shows it as text instead of running it.
export function cell(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  return [head, ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(","))].join("\r\n") + "\r\n";
}

// BOM so Excel opens Romanian diacritics (ș, ț) as UTF-8.
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
