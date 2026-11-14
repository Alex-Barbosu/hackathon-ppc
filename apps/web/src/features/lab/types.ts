// The contract's StorageLabCell has no read side, status or error detail yet; these shapes
// are what insights actually returns (proposed contract change in docs/c.md).
export type Category = "meter" | "outage" | "document" | "video";
export type Storage = "db" | "s3" | "ftp";

export interface Latency { p50Ms: number; p95Ms: number; p99Ms: number }
export interface LabCell {
  category: Category;
  storage: Storage;
  status: "pending" | "running" | "done";
  samples: number;
  completed: number;
  sizeBytes: number;
  method: "multipart" | "tus";
  write?: Latency;
  read?: Latency;
  throughputMBps?: number;
  errors: number;
  errorSamples: string[];
  integrityOk: boolean | null;
}
export interface Evidence { label: string; value: string }
export interface LabRecommendation {
  category: Category;
  storage: Storage;
  reason: string;
  reasons: string[];
  evidence: Evidence[];
  benchmarked: boolean;
}
export interface LabRun {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  samplesPerCell: number;
  cells: LabCell[];
  recommendation: LabRecommendation[];
  error?: string;
}

export const STORAGE_ORDER: readonly Storage[] = ["db", "s3", "ftp"];
export const STORAGE_NAME: Record<Storage, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS" };
export const CATEGORY_ROWS: ReadonlyArray<{ id: Category; label: string; size: string }> = [
  { id: "meter", label: "Meter readings", size: "1–50 KB" },
  { id: "outage", label: "Outage records", size: "5 MB samples" },
  { id: "document", label: "Documents", size: "2 MB samples" },
  { id: "video", label: "Drone video", size: "100 MB samples" },
];
