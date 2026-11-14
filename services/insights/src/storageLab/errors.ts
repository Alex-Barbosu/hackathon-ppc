import type { Cell } from "./types.js";

export type Phase = "upload" | "download";

// The contract's Error.code enum. Only these may be copied from a response body: anything
// else could be server-supplied free text, and errorSamples must never carry text.
const API_CODES = new Set([
  "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "TOO_LARGE",
  "INTEGRITY_FAILED", "STORAGE_UNAVAILABLE", "INTERNAL",
]);
const MAX_SAMPLES = 5;

/** Carries a "phase:CODE" string and nothing else; the message is the code on purpose. */
export class LabError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LabError";
  }
}

/** Phase-prefixed code from an error response; the body's message text is never read. */
export function codeFromResponse(phase: Phase, status: number, bodyText: string): string {
  try {
    const code = (JSON.parse(bodyText) as { code?: unknown }).code;
    if (typeof code === "string" && API_CODES.has(code)) return `${phase}:${code}`;
  } catch {
    // Not JSON (a proxy's HTML page, an empty 502): fall through to the status.
  }
  return `${phase}:HTTP_${status}`;
}

/** Anything that is not already a LabError came from the network layer (reset, timeout, DNS). */
export function asLabError(e: unknown, phase: Phase): LabError {
  return e instanceof LabError ? e : new LabError(`${phase}:NETWORK`);
}

/** Counts every failure, keeps each distinct code once, and stops at five. */
export function recordError(cell: Cell, code: string): void {
  cell.errors++;
  if (!cell.errorSamples.includes(code) && cell.errorSamples.length < MAX_SAMPLES) cell.errorSamples.push(code);
}
