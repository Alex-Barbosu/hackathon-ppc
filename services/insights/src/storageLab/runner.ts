import { ApiClient } from "./client.js";
import { recommend } from "./recommend.js";
import { latency, round } from "./stats.js";
import type { RunStore } from "./store.js";
import { BENCH_CATEGORIES, STORAGES, type Category, type Cell, type Run } from "./types.js";

const MB = 1024 * 1024;
const SIZE: Record<(typeof BENCH_CATEGORIES)[number], number> = { outage: 5 * MB, document: 2 * MB, video: 100 * MB };
const VIDEO_SAMPLE_CAP = 3;
// A storage that refuses twice in a row is refusing on principle (size, quota); more tries add nothing.
const MAX_CONSECUTIVE_ERRORS = 2;

export function planCells(samplesPerCell: number): Cell[] {
  return BENCH_CATEGORIES.flatMap((category) =>
    STORAGES.map<Cell>((storage) => ({
      category, storage, status: "pending", sizeBytes: SIZE[category],
      samples: category === "video" ? Math.min(samplesPerCell, VIDEO_SAMPLE_CAP) : samplesPerCell,
      method: category === "video" && storage === "s3" ? "tus" : "multipart",
      completed: 0, errors: 0, errorSamples: [], integrityOk: null,
    })),
  );
}

async function runCell(api: ApiClient, cell: Cell, save: () => Promise<void>): Promise<void> {
  cell.status = "running";
  const writes: number[] = [];
  const reads: number[] = [];
  let writeSec = 0;
  let readSec = 0;
  let consecutive = 0;
  let integrity = true;
  for (let i = 0; i < cell.samples && consecutive < MAX_CONSECUTIVE_ERRORS; i++) {
    try {
      const t0 = performance.now();
      const up = cell.method === "tus" ? await api.uploadTus(cell.category, cell.sizeBytes) : await api.uploadForced(cell.category, cell.storage, cell.sizeBytes);
      const wMs = performance.now() - t0;
      // A silent fallback would credit this storage with another one's speed.
      if (up.receipt.storage !== cell.storage) throw new Error(`stored on ${up.receipt.storage}, not ${cell.storage}`);
      const t1 = performance.now();
      const dl = await api.downloadHash(up.receipt.id);
      const rMs = performance.now() - t1;
      if (dl.sha256 !== up.sha256 || (up.receipt.sha256 && up.receipt.sha256 !== up.sha256)) {
        integrity = false;
        throw new Error("SHA-256 mismatch after download");
      }
      writes.push(wMs); reads.push(rMs); writeSec += wMs / 1000; readSec += rMs / 1000;
      consecutive = 0;
    } catch (e) {
      consecutive++;
      cell.errors++;
      if (cell.errorSamples.length < 2) cell.errorSamples.push(e instanceof Error ? e.message : "unknown error");
    }
    cell.completed++;
    if (writes.length) {
      cell.write = latency(writes); cell.read = latency(reads);
      Object.assign(cell, { p50Ms: cell.write.p50Ms, p95Ms: cell.write.p95Ms, p99Ms: cell.write.p99Ms });
      const mb = (writes.length * cell.sizeBytes) / MB;
      cell.throughputMBps = round(mb / writeSec); cell.readMBps = round(mb / readSec);
    }
    cell.errorRate = round(cell.errors / cell.completed, 3);
    cell.integrityOk = writes.length || !integrity ? integrity : null;
    await save();
  }
  cell.status = "done";
}

export async function executeRun(run: Run, api: ApiClient, store: RunStore, log: (m: string) => void): Promise<void> {
  const save = () => store.save(run);
  try {
    for (const cell of run.cells) {
      await runCell(api, cell, save);
      log(`cell ${cell.category}/${cell.storage} done: ${cell.errors} errors`);
      await save();
    }
    run.recommendation = recommend(run.cells);
    run.status = "done";
  } catch (e) {
    run.status = "failed";
    run.error = e instanceof Error ? e.message : "run failed";
  }
  run.finishedAt = new Date().toISOString();
  await save();
}

export type { Category };
