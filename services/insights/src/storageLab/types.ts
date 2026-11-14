export type Category = "meter" | "outage" | "document" | "video";
export type Storage = "db" | "s3" | "ftp";
export const BENCH_CATEGORIES = ["outage", "document", "video"] as const satisfies readonly Category[];
export const STORAGES = ["db", "s3", "ftp"] as const satisfies readonly Storage[];

export interface Latency { p50Ms: number; p95Ms: number; p99Ms: number }

/** Extends the contract's StorageLabCell; p50/p95/p99 mirror the write side for contract readers. */
export interface Cell {
  category: Category;
  storage: Storage;
  status: "pending" | "running" | "done";
  samples: number;
  completed: number;
  sizeBytes: number;
  method: "multipart" | "tus";
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  write?: Latency;
  read?: Latency;
  throughputMBps?: number;
  readMBps?: number;
  errorRate?: number;
  errors: number;
  errorSamples: string[];
  integrityOk: boolean | null;
}

export interface Evidence { label: string; value: string }
export interface Recommendation {
  category: Category;
  storage: Storage;
  reason: string;
  reasons: string[];
  evidence: Evidence[];
  benchmarked: boolean;
}

export interface Run {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  samplesPerCell: number;
  cells: Cell[];
  recommendation: Recommendation[];
  error?: string;
}
