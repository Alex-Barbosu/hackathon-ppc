// Survives restarts (`make up` rebuilds, crashes). Each meter's next period and seq, plus
// every reading not yet acked, are saved to a volume. Without this, a restart would either
// resend old keys (counted as duplicates although nothing was retried) or report the same
// quarter hours again under new keys (double billing in meter_intervals).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReadingRef } from "./reading.js";

export interface MeterCursor {
  nextPeriodMs: number;
  nextSeq: number;
}

export interface SimState {
  version: 1;
  roundRobin: number;
  meters: MeterCursor[];
  pending: ReadingRef[];
}

interface StateFile {
  version: 1;
  roundRobin: number;
  meters: [nextPeriodMs: number, nextSeq: number][];
  pending: [meterIndex: number, periodStartMs: number, seq: number, intervals: number][];
}

function isNumberArray(x: unknown, len: number): x is number[] {
  return Array.isArray(x) && x.length === len && x.every((v) => typeof v === "number" && Number.isFinite(v));
}

export async function loadState(path: string): Promise<SimState | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const data = JSON.parse(raw) as Partial<StateFile>;
  if (data.version !== 1 || !Array.isArray(data.meters) || !Array.isArray(data.pending)) {
    throw new Error(`${path}: unrecognised state file`);
  }
  const meters = data.meters.filter((m) => isNumberArray(m, 2)).map(([nextPeriodMs, nextSeq]) => ({ nextPeriodMs, nextSeq }));
  const pending = data.pending
    .filter((p) => isNumberArray(p, 4))
    .map(([meterIndex, periodStartMs, seq, intervals]) => ({ meterIndex, periodStartMs, seq, intervals }));
  return { version: 1, roundRobin: Number(data.roundRobin) || 0, meters, pending };
}

/** Write-then-rename, so a crash mid-write never leaves a truncated file. */
export async function saveState(path: string, state: SimState): Promise<void> {
  const file: StateFile = {
    version: 1,
    roundRobin: state.roundRobin,
    meters: state.meters.map((m) => [m.nextPeriodMs, m.nextSeq]),
    pending: state.pending.map((p) => [p.meterIndex, p.periodStartMs, p.seq, p.intervals]),
  };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(file));
  await rename(tmp, path);
}
