// Minimal Docker Engine API client over the unix socket. chaos-control is the only
// container with the socket, and it only ever touches the storage containers of its own
// Compose project (see ALLOWED_SERVICES in storages.ts).
import { request } from "node:http";

export interface ContainerRef {
  id: string;
  service: string;
  running: boolean;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerApi {
  findService(service: string): Promise<ContainerRef | undefined>;
  stop(id: string): Promise<void>;
  start(id: string): Promise<void>;
  exec(id: string, cmd: string[]): Promise<ExecResult>;
}

interface RawResponse {
  status: number;
  body: Buffer;
}

export class DockerError extends Error {}

export class DockerClient implements DockerApi {
  private project: Promise<string> | undefined;

  constructor(
    private readonly socketPath: string,
    private readonly fallbackProject: string,
    private readonly selfId: string | undefined,
  ) {}

  private call(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {},
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new DockerError(`docker ${method} ${path} timed out`)));
      req.on("error", (err) => reject(new DockerError(`docker ${method} ${path}: ${err.message}`)));
      req.end(payload);
    });
  }

  /** The Compose project this container belongs to, so we never touch another stack's containers. */
  private projectName(): Promise<string> {
    this.project ??= (async () => {
      if (!this.selfId) return this.fallbackProject;
      const res = await this.call("GET", `/containers/${encodeURIComponent(this.selfId)}/json`).catch(() => undefined);
      if (res?.status !== 200) return this.fallbackProject;
      const info = JSON.parse(res.body.toString()) as { Config?: { Labels?: Record<string, string> } };
      return info.Config?.Labels?.["com.docker.compose.project"] ?? this.fallbackProject;
    })();
    return this.project;
  }

  async findService(service: string): Promise<ContainerRef | undefined> {
    const project = await this.projectName();
    const filters = JSON.stringify({ label: [`com.docker.compose.project=${project}`, `com.docker.compose.service=${service}`] });
    const res = await this.call("GET", `/containers/json?all=1&filters=${encodeURIComponent(filters)}`);
    if (res.status !== 200) throw new DockerError(`docker list ${service}: HTTP ${res.status}`);
    const list = JSON.parse(res.body.toString()) as { Id: string; State: string }[];
    const first = list[0];
    return first ? { id: first.Id, service, running: first.State === "running" } : undefined;
  }

  async stop(id: string): Promise<void> {
    // 10 s lets PostgreSQL shut down cleanly; confirmed files must survive the demo.
    const res = await this.call("POST", `/containers/${id}/stop?t=10`, undefined, 30_000);
    if (res.status !== 204 && res.status !== 304) throw new DockerError(`docker stop: HTTP ${res.status} ${res.body.toString()}`);
  }

  async start(id: string): Promise<void> {
    const res = await this.call("POST", `/containers/${id}/start`);
    if (res.status !== 204 && res.status !== 304) throw new DockerError(`docker start: HTTP ${res.status} ${res.body.toString()}`);
  }

  async exec(id: string, cmd: string[]): Promise<ExecResult> {
    const created = await this.call("POST", `/containers/${id}/exec`, { Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
    if (created.status !== 201) throw new DockerError(`docker exec create: HTTP ${created.status} ${created.body.toString()}`);
    const execId = (JSON.parse(created.body.toString()) as { Id: string }).Id;
    const started = await this.call("POST", `/exec/${execId}/start`, { Detach: false, Tty: false }, 120_000);
    if (started.status !== 200) throw new DockerError(`docker exec start: HTTP ${started.status}`);
    const { stdout, stderr } = demux(started.body);
    const inspected = await this.call("GET", `/exec/${execId}/json`);
    const exitCode = (JSON.parse(inspected.body.toString()) as { ExitCode: number | null }).ExitCode ?? -1;
    return { exitCode, stdout, stderr };
  }
}

/** Docker multiplexes stdout/stderr without a TTY: 8-byte header (stream, 3 pad, uint32 size) per frame. */
export function demux(buf: Buffer): { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const stream = buf[i];
    const size = buf.readUInt32BE(i + 4);
    const frame = buf.subarray(i + 8, i + 8 + size);
    (stream === 2 ? err : out).push(frame);
    i += 8 + size;
  }
  return { stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() };
}
