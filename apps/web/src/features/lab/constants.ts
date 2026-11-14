import type { Category, Storage } from "../../lib/domain";

export const STORAGE_ORDER: readonly Storage[] = ["db", "s3", "ftp"];
export const STORAGE_NAME: Record<Storage, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS" };
export const CATEGORY_ROWS: ReadonlyArray<{ id: Category; label: string; size: string }> = [
  { id: "meter", label: "Meter readings", size: "1–50 KB" },
  { id: "outage", label: "Outage records", size: "5 MB samples" },
  { id: "document", label: "Documents", size: "2 MB samples" },
  { id: "video", label: "Drone video", size: "100 MB samples" },
];
