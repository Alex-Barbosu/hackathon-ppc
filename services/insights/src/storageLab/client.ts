import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mintAdminToken } from "./auth.js";
import { multipart, randomPayload } from "./payload.js";
import type { Category, Storage } from "./types.js";

export interface Receipt { id: string; storage: string; sha256: string }
const TUS_PART = 16 * 1024 * 1024;

export class ApiClient {
  constructor(private readonly base: string, private readonly secret: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${mintAdminToken(this.secret)}`, ...extra };
  }

  private async fail(res: Response, what: string): Promise<never> {
    // Error bodies carry a code and message only (zone A never echoes file content).
    const raw = (await res.text().catch(() => "")).slice(0, 400);
    let detail = "";
    try {
      const j = JSON.parse(raw) as { code?: string; message?: string };
      detail = [j.code, j.message].filter(Boolean).join(": ");
    } catch {
      detail = raw.slice(0, 120);
    }
    throw new Error(`${what}: HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
  }

  /** Multipart upload with the policy bypassed, so the byte path of one storage is measured. */
  async uploadForced(category: Category, storage: Storage, size: number): Promise<{ receipt: Receipt; sha256: string }> {
    const p = randomPayload(size);
    const mp = multipart({ category, description: "storage-lab benchmark" }, `storage-lab-${storage}.bin`, size, p.stream);
    const res = await fetch(`${this.base}/api/v1/files`, {
      method: "POST",
      headers: this.headers({ "content-type": mp.contentType, "content-length": String(mp.length), "X-FileGrid-Force-Storage": storage }),
      body: Readable.toWeb(mp.body) as ReadableStream,
      duplex: "half",
    } as RequestInit);
    if (res.status !== 201) await this.fail(res, "upload");
    return { receipt: (await res.json()) as Receipt, sha256: p.sha256() };
  }

  /** Resumable upload, part by part. tus always lands on S3 (zone A), so no force header. */
  async uploadTus(category: Category, size: number): Promise<{ receipt: Receipt; sha256: string }> {
    const meta = `category ${Buffer.from(category).toString("base64")},filename ${Buffer.from("storage-lab-s3.bin").toString("base64")}`;
    const created = await fetch(`${this.base}/api/v1/files/tus`, {
      method: "POST",
      headers: this.headers({ "Tus-Resumable": "1.0.0", "Upload-Length": String(size), "Upload-Metadata": meta }),
    });
    if (created.status !== 201) await this.fail(created, "tus create");
    const location = created.headers.get("location") ?? "";
    const url = location.startsWith("http") ? location : `${this.base}${location}`;
    const hash = createHash("sha256");
    let offset = 0;
    let fileId = "";
    while (offset < size) {
      const part = Buffer.concat(await drain(randomPayload(Math.min(TUS_PART, size - offset)), hash));
      const res = await fetch(url, {
        method: "PATCH",
        headers: this.headers({ "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "content-type": "application/offset+octet-stream" }),
        body: part,
      });
      if (res.status !== 204) await this.fail(res, "tus patch");
      offset += part.length;
      fileId = res.headers.get("x-filegrid-file-id") ?? fileId;
    }
    if (!fileId) throw new Error("tus finished without a file id");
    const meta2 = await fetch(`${this.base}/api/v1/files/${fileId}`, { headers: this.headers() });
    if (!meta2.ok) await this.fail(meta2, "metadata");
    const m = (await meta2.json()) as { storage?: string; sha256?: string; receipt?: Receipt };
    return { receipt: { id: fileId, storage: m.storage ?? "?", sha256: m.sha256 ?? "" }, sha256: hash.digest("hex") };
  }

  /** Streams the download through SHA-256; nothing is buffered. */
  async downloadHash(id: string): Promise<{ sha256: string; header: string | null }> {
    const res = await fetch(`${this.base}/api/v1/files/${id}/content`, { headers: this.headers() });
    if (!res.ok || !res.body) await this.fail(res, "download");
    const hash = createHash("sha256");
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) hash.update(chunk);
    return { sha256: hash.digest("hex"), header: res.headers.get("x-content-sha256") };
  }
}

async function drain(p: ReturnType<typeof randomPayload>, hash: ReturnType<typeof createHash>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const c of p.stream) {
    hash.update(c as Buffer);
    out.push(c as Buffer);
  }
  return out;
}
