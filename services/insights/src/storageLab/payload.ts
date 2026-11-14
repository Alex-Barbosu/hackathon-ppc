import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

const CHUNK = 1024 * 1024;

export interface Payload { stream: Readable; sha256: () => string }

/** Random bytes produced one chunk at a time, so a 100 MB sample never sits in memory. */
export function randomPayload(size: number): Payload {
  const hash = createHash("sha256");
  let left = size;
  const stream = Readable.from(
    (async function* () {
      while (left > 0) {
        const buf = randomBytes(Math.min(CHUNK, left));
        left -= buf.length;
        hash.update(buf);
        yield buf;
      }
    })(),
  );
  return { stream, sha256: () => hash.copy().digest("hex") };
}

export interface Multipart { body: Readable; contentType: string; length: number }

/** Hand-built multipart body with a known length, wrapping a streamed file part. */
export function multipart(fields: Record<string, string>, filename: string, size: number, file: Readable): Multipart {
  const boundary = `----storagelab${randomBytes(8).toString("hex")}`;
  const head = Object.entries(fields)
    .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    .join("");
  const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const pre = Buffer.from(head + fileHead);
  const post = Buffer.from(tail);
  const body = Readable.from(
    (async function* () {
      yield pre;
      for await (const c of file) yield c as Buffer;
      yield post;
    })(),
  );
  return { body, contentType: `multipart/form-data; boundary=${boundary}`, length: pre.length + size + post.length };
}
