export function fmtMs(n: number | undefined): string {
  if (n === undefined) return "–";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${n.toFixed(n < 10 ? 1 : 0)} ms`;
}
export const fmtMbps = (n: number | undefined) => (n === undefined ? "–" : `${n.toFixed(n < 10 ? 1 : 0)} MB/s`);
