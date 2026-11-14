// All knobs come from the environment (set in compose.yml from .env), validated once at
// start so a typo fails loudly instead of silently sending nothing.

export type Profile = "normal" | "peak";

/** A peak day sends ten times the normal volume (brief: "normal vs peak day"). */
export const PROFILE_MULTIPLIER: Record<Profile, number> = { normal: 1, peak: 10 };

/** Same ceiling as POST /chaos/meters in contracts/openapi.yaml. */
export const MAX_RATE = 5000;

export interface Config {
  port: number;
  targetUrl: string;
  deviceToken: string;
  meterCount: number;
  readingsPerSec: number;
  profile: Profile;
  intervalsPerFile: number;
  minBytes: number;
  maxBytes: number;
  backfillDays: number;
  maxInFlight: number;
  requestTimeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  statePath: string;
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${key}=${raw} must be a number between ${min} and ${max}`);
  }
  return n;
}

export function loadConfig(env: Env = process.env): Config {
  const profile = env.METER_PROFILE ?? "normal";
  if (profile !== "normal" && profile !== "peak") {
    throw new Error(`METER_PROFILE=${profile} must be "normal" or "peak"`);
  }
  const minKb = num(env, "METER_FILE_MIN_KB", 2, 1, 50);
  const maxKb = num(env, "METER_FILE_MAX_KB", 12, 1, 50);
  if (minKb > maxKb) throw new Error("METER_FILE_MIN_KB must not exceed METER_FILE_MAX_KB");
  return {
    port: num(env, "PORT", 9100, 1, 65535),
    targetUrl: env.METER_TARGET_URL || "http://caddy:8088/api/v1/meter-readings",
    deviceToken: env.METER_DEVICE_TOKEN || "dev-device-token",
    meterCount: Math.floor(num(env, "METER_COUNT", 500, 1, 1_000_000)),
    readingsPerSec: num(env, "READINGS_PER_SEC", 1, 0, MAX_RATE),
    profile,
    // 1 = one quarter hour per file; 96 = a daily load profile. Capped so files stay < 50 KB.
    intervalsPerFile: Math.floor(num(env, "METER_INTERVALS_PER_FILE", 1, 1, 384)),
    minBytes: Math.floor(minKb * 1024),
    maxBytes: Math.floor(maxKb * 1024),
    backfillDays: num(env, "METER_BACKFILL_DAYS", 14, 0, 365),
    maxInFlight: Math.floor(num(env, "METER_MAX_IN_FLIGHT", 64, 1, 10_000)),
    requestTimeoutMs: num(env, "METER_REQUEST_TIMEOUT_MS", 10_000, 100, 120_000),
    retryBaseMs: num(env, "METER_RETRY_BASE_MS", 250, 1, 60_000),
    retryMaxMs: num(env, "METER_RETRY_MAX_MS", 30_000, 1, 600_000),
    statePath: env.METER_STATE_PATH || "/data/state.json",
  };
}
