import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mintAdminToken } from "./auth.js";
import { codeFromResponse, LabError, type Phase } from "./errors.js";
import { multipart, randomPayload } from "./payload.js";
import type { Category, Storage } from "./types.js";

export interface Receipt { id: string; storage: string; sha256: string }
const TUS_PART = 16 * 1024 * 1024;

export class ApiClient {
  constructor(private readonly base: string, private readonly secret: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${mintAdminToken(this.secret)}`, ...extra };
  }

  private async fail(res: Response, phase: Phase): Promise<never> {
    // Only the code is kept (see errors.ts); the response text is read and dropped.
    throw new LabError(codeFromResponse(phase, res.status, (await res.text().catch(() => "")).slice(0, 400)));
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
    if (created.status !== 201) await this.fail(created, "upload");
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
      if (res.status !== 204) await this.fail(res, "upload");
      offset += part.length;
      fileId = res.headers.get("x-filegrid-file-id") ?? fileId;
    }
    if (!fileId) throw new LabError("upload:INTERNAL");
    const meta2 = await fetch(`${this.base}/api/v1/files/${fileId}`, { headers: this.headers() });
    if (!meta2.ok) await this.fail(meta2, "upload");
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

  /** Benchmark files left by runs made before the Lab cleaned up after itself. Named storage-lab-*, so nothing else matches. */
  async leftovers(): Promise<string[]> {
    const res = await fetch(`${this.base}/api/v1/files?q=storage-lab-&size=100`, { headers: this.headers() });
    if (!res.ok) return [];
    const page = (await res.json()) as { items?: Array<{ id: string; originalName?: string }> };
    return (page.items ?? []).filter((f) => f.originalName?.startsWith("storage-lab-")).map((f) => f.id);
  }

  /** Best effort: a benchmark file that stays behind only clutters the Library, it does not spoil a measurement. */
  async remove(id: string): Promise<void> {
    await fetch(`${this.base}/api/v1/files/${id}`, { method: "DELETE", headers: this.headers() }).then((r) => r.body?.cancel(), () => undefined);
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
