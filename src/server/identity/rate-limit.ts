/**
 * In-process token buckets for the sign-in, set-password and reset endpoints (Spec §18). This is the
 * edge throttle that sits in front of the per-account lockout; a multi-instance deployment should add a
 * reverse-proxy rate limit as well. Keys are opaque strings (IP, or IP + lower-cased username).
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

export interface RateLimitRule {
  capacity: number;
  /** tokens regained per minute */
  refillPerMinute: number;
}

export const SIGN_IN_RULE: RateLimitRule = { capacity: 10, refillPerMinute: 5 };
export const TOKEN_RULE: RateLimitRule = { capacity: 5, refillPerMinute: 1 };

/** Returns true when the request may proceed (one token consumed), false when throttled. */
export function takeToken(key: string, rule: RateLimitRule, now = Date.now()): boolean {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) buckets.clear();
    b = { tokens: rule.capacity, updatedAt: now };
    buckets.set(key, b);
  }
  const elapsedMin = (now - b.updatedAt) / 60_000;
  b.tokens = Math.min(rule.capacity, b.tokens + elapsedMin * rule.refillPerMinute);
  b.updatedAt = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

/** Best-effort client address behind a reverse proxy; never trusted for anything but throttling. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}
