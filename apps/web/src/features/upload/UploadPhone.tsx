import { PhoneFrame } from "../../components/phone/PhoneFrame";
import { PhoneScreen, type PhoneRow } from "../../components/phone/PhoneScreen";
import { Chip } from "../../components/ui";
import { REGIONS, UPLOAD_CATEGORIES, type FileReceipt } from "../../lib/domain";
import { formatBytes, truncateMiddle } from "../../lib/format";
import { useUploadForm } from "./useUploadForm";

interface UploadPhoneProps {
  file: File | null;
  receipt: FileReceipt | null;
  pending: boolean;
  percent: number | null;
}

const STORAGE: Record<string, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS", spool: "Spool" };

// The handset mirrors the form live, so the 3D device shows this upload, not stock art.
export function UploadPhone({ file, receipt, pending, percent }: UploadPhoneProps) {
  const { category, region, county } = useUploadForm();
  const place = REGIONS.find((r) => r.id === region)?.label ?? region;
  const label = UPLOAD_CATEGORIES.find((c) => c.id === category)?.label ?? category;
  const rows: PhoneRow[] = receipt
    ? [
        { label: "Storage", value: STORAGE[receipt.storage] ?? receipt.storage },
        { label: "Size", value: formatBytes(receipt.sizeBytes) },
        { label: "SHA-256", value: <span className="font-mono">{truncateMiddle(receipt.sha256, 6, 4)}</span> },
        { label: "Encrypted", value: receipt.encrypted ? "AES-256-GCM" : "No" },
      ]
    : [
        { label: "Category", value: label },
        { label: "Region", value: county ? `${county}, ${place}` : place },
        { label: "File", value: file?.name ?? "None yet" },
        { label: "Size", value: file ? formatBytes(file.size) : "–" },
      ];
  const title = receipt ? <>Stored and <em>verified</em>.</> : pending ? <>Uploading<em>…</em></> : <>Ready when <em>you</em> are.</>;
  const status = receipt ? <Chip tone={receipt.storage === "spool" ? "warn" : "good"}>{receipt.storage === "spool" ? "Spooled, will move" : "Receipt issued"}</Chip>
    : pending ? <Chip tone="info">{percent != null ? `${percent}% sent` : "Hashing and storing"}</Chip>
    : <Chip tone="neutral">Nothing sent yet</Chip>;
  return (
    <div className="hidden lg:sticky lg:top-28 lg:block">
      <PhoneFrame label="Live preview of this upload on a phone" tilt="left">
        <PhoneScreen eyebrow={receipt ? "Receipt" : "This upload"} title={title} status={status} rows={rows} />
      </PhoneFrame>
    </div>
  );
}
