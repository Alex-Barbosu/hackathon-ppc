// Network degradation through Toxiproxy (infra/toxiproxy/toxiproxy.json). Only toxics
// named fg_* are ours; state is read back from Toxiproxy so it survives our restarts.

export type NetTarget = "client" | "db" | "s3" | "ftp";

export interface NetworkCondition {
  target: NetTarget;
  latencyMs?: number;
  jitterMs?: number;
  lossPct?: number;
  bandwidthKbps?: number;
}

/** vsftpd's passive data ports (infra/ftp/vsftpd.conf pasv_min_port..pasv_max_port). */
export const FTP_PASV_PORTS: readonly number[] = Array.from({ length: 10 }, (_, i) => 30000 + i);

/**
 * Proxies a target's traffic passes through; the first one is read back for /state.
 * FTP needs more than its control proxy: file bytes travel on separate passive data
 * connections, so a toxic on the control channel alone slows the commands but not the
 * transfer. Every passive port has its own proxy (infra/toxiproxy/toxiproxy.json).
 */
export const PROXY_FOR: Record<NetTarget, readonly [string, ...string[]]> = {
  client: ["client_slowlane"],
  db: ["pg"],
  s3: ["s3"],
  ftp: ["ftp", ...FTP_PASV_PORTS.map((p) => `ftp_pasv_${p}`)],
};

export interface Toxic {
  name: string;
  type: string;
  stream: "upstream" | "downstream";
  toxicity: number;
  attributes: Record<string, number>;
}

/** Delay before a "lost" connection is reset: long enough that transfers are cut mid-flight. */
const LOSS_RESET_AFTER_MS = 1000;

/**
 * Maps a condition to toxics. Latency and jitter are split across both directions, so the
 * round trip grows by latencyMs. Bandwidth applies both ways (uploads matter for videos).
 * TCP proxies cannot drop single packets, so lossPct resets that share of connections,
 * which is what a lossy link looks like to an HTTP client: a broken transfer to resume.
 */
export function toxicsFor(c: NetworkCondition): Toxic[] {
  const toxics: Toxic[] = [];
  const latency = c.latencyMs ?? 0;
  const jitter = c.jitterMs ?? 0;
  if (latency > 0 || jitter > 0) {
    for (const stream of ["upstream", "downstream"] as const) {
      toxics.push({ name: `fg_latency_${stream}`, type: "latency", stream, toxicity: 1, attributes: { latency: Math.round(latency / 2), jitter: Math.round(jitter / 2) } });
    }
  }
  const kbps = c.bandwidthKbps ?? 0;
  if (kbps > 0) {
    for (const stream of ["upstream", "downstream"] as const) {
      toxics.push({ name: `fg_bandwidth_${stream}`, type: "bandwidth", stream, toxicity: 1, attributes: { rate: Math.max(1, Math.round(kbps / 8)) } });
    }
  }
  const loss = c.lossPct ?? 0;
  if (loss > 0) {
    toxics.push({ name: "fg_loss", type: "reset_peer", stream: "downstream", toxicity: Math.min(1, loss / 100), attributes: { timeout: LOSS_RESET_AFTER_MS } });
  }
  return toxics;
}

/** Inverse of toxicsFor, for GET /chaos/state. Undefined when the proxy carries none of ours. */
export function conditionFrom(target: NetTarget, toxics: Toxic[]): NetworkCondition | undefined {
  const ours = toxics.filter((t) => t.name.startsWith("fg_"));
  if (ours.length === 0) return undefined;
  const c: NetworkCondition = { target, latencyMs: 0, jitterMs: 0, lossPct: 0, bandwidthKbps: 0 };
  for (const t of ours) {
    if (t.type === "latency") {
      c.latencyMs = (c.latencyMs ?? 0) + (t.attributes.latency ?? 0);
      c.jitterMs = (c.jitterMs ?? 0) + (t.attributes.jitter ?? 0);
    } else if (t.type === "bandwidth" && t.stream === "upstream") {
      c.bandwidthKbps = (t.attributes.rate ?? 0) * 8;
    } else if (t.type === "reset_peer") {
      c.lossPct = Math.round(t.toxicity * 1000) / 10;
    }
  }
  return c;
}

export interface ToxiproxyApi {
  apply(c: NetworkCondition): Promise<void>;
  conditions(): Promise<NetworkCondition[]>;
  reset(): Promise<void>;
}

export class ToxiproxyClient implements ToxiproxyApi {
  constructor(private readonly baseUrl: string) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`toxiproxy ${method} ${path}: HTTP ${res.status} ${text}`);
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private async toxicsOf(proxy: string): Promise<Toxic[]> {
    return (await this.call("GET", `/proxies/${proxy}/toxics`)) as Toxic[];
  }

  async apply(c: NetworkCondition): Promise<void> {
    await Promise.all(PROXY_FOR[c.target].map(async (proxy) => {
      for (const t of await this.toxicsOf(proxy)) {
        if (t.name.startsWith("fg_")) await this.call("DELETE", `/proxies/${proxy}/toxics/${t.name}`);
      }
      for (const t of toxicsFor(c)) await this.call("POST", `/proxies/${proxy}/toxics`, t);
    }));
  }

  async conditions(): Promise<NetworkCondition[]> {
    const out: NetworkCondition[] = [];
    for (const target of Object.keys(PROXY_FOR) as NetTarget[]) {
      const c = conditionFrom(target, await this.toxicsOf(PROXY_FOR[target][0]));
      if (c) out.push(c);
    }
    return out;
  }

  async reset(): Promise<void> {
    // Removes every toxic and re-enables every proxy.
    await this.call("POST", "/reset");
  }
}
