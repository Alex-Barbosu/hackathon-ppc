// ntfy is the pager's transport (contracts/alerts.md "Paging"). It is HTTP in both directions, so the
// phone never has to reach the gateway: the push goes out to ntfy, and the phone's Acknowledge button
// posts back to an ntfy topic that insights listens on.

export interface NtfyConfig { url: string; topic: string; token?: string }

export interface NtfyAction { action: "view" | "http"; label: string; url: string; method?: "POST"; body?: string; clear?: boolean }
export interface NtfyMessage { topic: string; title: string; message: string; priority: 1 | 2 | 3 | 4 | 5; tags?: string[]; click?: string; actions?: NtfyAction[] }

const TOPIC = /^[A-Za-z0-9_-]{1,40}$/;

/** Null when paging to a phone is off. A malformed topic is off too, never a half-working pager. */
export function ntfyFromEnv(env: NodeJS.ProcessEnv, warn: (m: string) => void = () => {}): NtfyConfig | null {
  const topic = env.NTFY_TOPIC?.trim();
  if (!topic) return null;
  if (!TOPIC.test(topic)) { warn("NTFY_TOPIC must be 1-40 letters, digits, - or _; phone paging is off"); return null; }
  const url = (env.NTFY_URL?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
  // On a public server the topic name is the only secret: anyone who guesses it reads the pages.
  if (url === "https://ntfy.sh" && topic.length < 16) warn("NTFY_TOPIC is short for the public ntfy.sh server; use a long random name");
  const token = env.NTFY_TOKEN?.trim();
  return { url, topic, ...(token ? { token } : {}) };
}

export const ackTopic = (c: NtfyConfig): string => `${c.topic}-ack`;
const headers = (c: NtfyConfig): Record<string, string> => (c.token ? { authorization: `Bearer ${c.token}` } : {});

export type Fetch = typeof fetch;

export async function publish(c: NtfyConfig, m: NtfyMessage, f: Fetch = fetch): Promise<void> {
  const res = await f(c.url, {
    method: "POST", headers: { "content-type": "application/json", ...headers(c) },
    body: JSON.stringify(m), signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
}

/** `ack:<pageId>:<token>` as the phone's button posts it; anything else on the topic is ignored. */
export function parseAck(text: unknown): { id: number; token: string } | null {
  const m = typeof text === "string" ? /^ack:(\d{1,12}):([a-f0-9]{32})$/.exec(text.trim()) : null;
  return m ? { id: Number(m[1]), token: m[2] as string } : null;
}

/**
 * Follows the ack topic for as long as the service runs, reconnecting with backoff. `since` resumes after the
 * last message seen, so a reconnect never drops an acknowledgement (replays are harmless: acks are idempotent).
 */
export async function listenAcks(c: NtfyConfig, onAck: (a: { id: number; token: string }) => Promise<void>, stop: AbortSignal, log: (m: string) => void, f: Fetch = fetch): Promise<void> {
  let since = "10m";
  let wait = 2000;
  while (!stop.aborted) {
    try {
      const res = await f(`${c.url}/${ackTopic(c)}/json?since=${encodeURIComponent(since)}`, { headers: headers(c), signal: stop });
      if (!res.ok || !res.body) throw new Error(`ntfy answered ${res.status}`);
      wait = 2000;
      let buf = "";
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          const ev = safeJson(line);
          if (ev?.event !== "message") continue;
          if (typeof ev.id === "string") since = ev.id;
          const ack = parseAck(ev.message);
          if (ack) await onAck(ack).catch(() => log("pager: storing a phone acknowledgement failed"));
        }
      }
    } catch (e) {
      if (stop.aborted) return;
      log(`pager: ack listener reconnecting (${e instanceof Error ? e.message : "error"})`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 30_000);
  }
}

function safeJson(line: string): { event?: string; id?: unknown; message?: unknown } | null {
  try { return JSON.parse(line) as { event?: string; id?: unknown; message?: unknown }; } catch { return null; }
}
