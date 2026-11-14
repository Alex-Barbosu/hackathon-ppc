import type { LabCell } from "../../lib/domain.ts";
import { formatBytes } from "../../lib/format.ts";

type Facts = Pick<LabCell, "sizeBytes">;
type Outcome = Pick<LabCell, "category" | "storage" | "write" | "errors" | "errorSamples">;

const TOO_LARGE = "upload:TOO_LARGE";

/** Plain sentence for one error code from insights ("phase:CODE"), using the cell's own facts. */
export function errorText(sample: string, cell: Facts): string {
  switch (sample) {
    case TOO_LARGE:
      return `Rejected: ${formatBytes(cell.sizeBytes)} is over this storage's upload limit. Large files need a streaming, resumable path (S3 + tus).`;
    case "download:INTEGRITY_FAILED":
      return "Downloaded bytes did not match the stored SHA-256.";
    case "upload:INTEGRITY_FAILED":
      return "The stored file's SHA-256 did not match the bytes that were sent.";
    case "upload:STORAGE_UNAVAILABLE":
    case "download:STORAGE_UNAVAILABLE":
      return "Storage was unavailable during the run.";
    case "upload:NETWORK":
    case "download:NETWORK":
      return "The connection to the API dropped during the run.";
    case "upload:FALLBACK":
      return "The file was stored on a different storage than the one under test.";
    default:
      return sample;
  }
}

/**
 * Video on PostgreSQL or FTPS is refused for size on purpose (large files belong on S3 + tus),
 * so it is shown as a design fact, not as a fault. Any other failure keeps the error look.
 */
export function rejectedByDesign(cell: Outcome): boolean {
  return (
    cell.category === "video" &&
    cell.storage !== "s3" &&
    cell.errors > 0 &&
    cell.write === undefined &&
    cell.errorSamples.length > 0 &&
    cell.errorSamples.every((s) => s === TOO_LARGE)
  );
}
