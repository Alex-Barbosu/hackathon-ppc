// Stop/start storage containers and flip bytes of a stored file behind FileGrid's back,
// so the demo can show that FileGrid notices (422 INTEGRITY_FAILED on download).
// Only these three Compose services can ever be touched: nothing else is reachable here.
import type { DockerApi } from "./docker.js";

export type StorageName = "db" | "s3" | "ftp";

export const ALLOWED_SERVICES: Record<StorageName, string> = {
  db: "postgres",
  s3: "seaweedfs",
  ftp: "ftp",
};

export class ChaosError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Object keys FileGrid writes: ids, bucket/id. Anything else is refused before any exec. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface StoredFile {
  storage: string;
  objectKey: string;
  sizeBytes: number;
}

export interface CorruptResult {
  storage: StorageName;
  offset: number;
}

// The file id arrives as psql variable :'id' (quoted by psql), never spliced into SQL.
const LOOKUP_SQL = "select storage || '|' || object_key || '|' || size_bytes from files where id = :'id';";
const CORRUPT_DB_SQL =
  "update stored_blobs set data = set_byte(data, length(data) / 2, get_byte(data, length(data) / 2) # 255) " +
  "where file_id = :'id' and length(data) > 0 returning length(data) / 2;";

/** Runs one fixed SQL statement in the postgres container with the id bound as a psql variable. */
function psql(sql: string, id: string): string[] {
  return ["sh", "-c", 'printf "%s\\n" "$1" | psql -U filegrid -d filegrid -v ON_ERROR_STOP=1 -tA -v id="$2"', "sh", sql, id];
}

// Flips the middle byte of a file in the FTP user's home. Path and nothing else come in as $1.
const FLIP_FTP_SH = [
  'f="/home/ftpusers/filegrid/$1"',
  '[ -f "$f" ] || { echo "no such file" >&2; exit 3; }',
  'size=$(stat -c %s "$f"); [ "$size" -gt 0 ] || { echo "empty file" >&2; exit 4; }',
  "off=$((size / 2))",
  "b=$(dd if=\"$f\" bs=1 skip=$off count=1 2>/dev/null | od -An -tu1 | tr -d ' ')",
  "printf \"$(printf '\\\\%03o' $((b ^ 255)))\" | dd of=\"$f\" bs=1 seek=$off conv=notrunc 2>/dev/null",
  'echo "$off"',
].join("\n");

export interface Filer {
  /** Rewrites an object in SeaweedFS with one byte flipped; returns the offset. */
  flipByte(objectKey: string): Promise<number>;
}

export class SeaweedFiler implements Filer {
  constructor(private readonly baseUrl: string) {}

  async flipByte(objectKey: string): Promise<number> {
    // S3 objects live in the filer under /buckets/<bucket>/<key>; going through the filer
    // bypasses FileGrid and the S3 API, as a direct storage breach would.
    const url = `${this.baseUrl}/buckets/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
    const got = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (got.status === 404) throw new ChaosError(404, "NOT_FOUND", "object not found in SeaweedFS");
    if (!got.ok || !got.body) throw new ChaosError(502, "STORAGE_ERROR", `SeaweedFS GET: HTTP ${got.status}`);
    const size = Number(got.headers.get("content-length") ?? "0");
    if (!(size > 0)) throw new ChaosError(409, "EMPTY", "object is empty or has no length");
    const offset = Math.floor(size / 2);
    let pos = 0;
    // Streamed: a 1 GB video is corrupted with flat memory.
    const flipped = got.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          if (offset >= pos && offset < pos + chunk.length) {
            const copy = new Uint8Array(chunk);
            copy[offset - pos] = (copy[offset - pos] ?? 0) ^ 0xff;
            ctl.enqueue(copy);
          } else ctl.enqueue(chunk);
          pos += chunk.length;
        },
      }),
    );
    const put = await fetch(url, {
      method: "PUT",
      body: flipped,
      duplex: "half",
      headers: { "content-type": got.headers.get("content-type") ?? "application/octet-stream" },
      signal: AbortSignal.timeout(600_000),
    } as RequestInit);
    if (!put.ok) throw new ChaosError(502, "STORAGE_ERROR", `SeaweedFS PUT: HTTP ${put.status} ${await put.text()}`);
    await put.arrayBuffer();
    return offset;
  }
}

export class Storages {
  constructor(
    private readonly docker: DockerApi,
    private readonly filer: Filer,
  ) {}

  async states(): Promise<Record<StorageName, "running" | "stopped">> {
    const entries = await Promise.all(
      (Object.keys(ALLOWED_SERVICES) as StorageName[]).map(async (s) => {
        const c = await this.docker.findService(ALLOWED_SERVICES[s]);
        return [s, c?.running ? "running" : "stopped"] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<StorageName, "running" | "stopped">;
  }

  async setRunning(storage: StorageName, running: boolean): Promise<void> {
    const c = await this.docker.findService(ALLOWED_SERVICES[storage]);
    if (!c) throw new ChaosError(404, "NOT_FOUND", `no ${ALLOWED_SERVICES[storage]} container in this project`);
    if (running) await this.docker.start(c.id);
    else await this.docker.stop(c.id);
  }

  async corrupt(fileId: string): Promise<CorruptResult> {
    if (!UUID.test(fileId)) throw new ChaosError(400, "BAD_REQUEST", "fileId must be a UUID");
    const pg = await this.running("db");
    const lookup = await this.docker.exec(pg, psql(LOOKUP_SQL, fileId));
    if (lookup.exitCode !== 0) throw new ChaosError(502, "STORAGE_ERROR", `file lookup failed: ${lookup.stderr.trim()}`);
    const row = lookup.stdout.trim();
    if (!row) throw new ChaosError(404, "NOT_FOUND", "no file with this id");
    const [storage = "", objectKey = ""] = row.split("|");
    if (storage === "db") {
      const res = await this.docker.exec(pg, psql(CORRUPT_DB_SQL, fileId));
      const offset = Number(res.stdout.trim().split("\n")[0]);
      if (res.exitCode !== 0 || !Number.isFinite(offset) || res.stdout.trim() === "") {
        throw new ChaosError(502, "STORAGE_ERROR", `db corruption failed: ${res.stderr.trim() || "no blob row"}`);
      }
      return { storage: "db", offset };
    }
    if (!SAFE_KEY.test(objectKey) || objectKey.includes("..")) throw new ChaosError(409, "UNSAFE_KEY", "object key has an unexpected shape");
    if (storage === "s3") {
      await this.running("s3");
      return { storage: "s3", offset: await this.filer.flipByte(objectKey) };
    }
    if (storage === "ftp") {
      const ftp = await this.running("ftp");
      const res = await this.docker.exec(ftp, ["sh", "-c", FLIP_FTP_SH, "sh", objectKey]);
      if (res.exitCode !== 0) throw new ChaosError(res.exitCode === 3 ? 404 : 502, "STORAGE_ERROR", `ftp corruption failed: ${res.stderr.trim()}`);
      return { storage: "ftp", offset: Number(res.stdout.trim()) };
    }
    throw new ChaosError(409, "UNSUPPORTED", `file is in ${storage}; only db, s3 and ftp can be corrupted`);
  }

  /** Container id of a running storage, or 409: corrupting needs the storage up. */
  private async running(storage: StorageName): Promise<string> {
    const c = await this.docker.findService(ALLOWED_SERVICES[storage]);
    if (!c?.running) throw new ChaosError(409, "STORAGE_STOPPED", `${storage} is stopped; start it first`);
    return c.id;
  }
}
