// In-memory token-bucket rate limiter.
//
// Purpose: cap abuse on expensive serverFns (chat proxy, trial start) without
// pulling in a Redis or Upstash dependency. Vercel serverless functions can
// each get a fresh module instance on cold start, so this is best-effort —
// a determined attacker can burn through cold-start boundaries, but the
// steady-state limit per warm process is enforced.
//
// For production-grade rate limiting, swap the bucket map for Upstash
// Ratelimit (or similar). The interface stays the same — serverFns import
// consume() and inspect the returned RateLimitResult.

export type RateLimitResult = {
  /** True when the request is allowed. */
  ok: boolean;
  /** Tokens remaining in the bucket after this call. */
  remaining: number;
  /** Milliseconds until the bucket refills enough for one more request. */
  retryAfterMs: number;
};

type Bucket = {
  // Tokens currently in the bucket. Integer.
  tokens: number;
  // Last refill timestamp (ms since epoch).
  lastRefill: number;
};

const STORE = new Map<string, Bucket>();

// Defensive cap so the map doesn't grow unbounded on a long-lived warm
// process. LRU-ish: when over size, evict the bucket whose lastRefill is
// the oldest.
const MAX_KEYS = 10_000;

function evictIfFull() {
  if (STORE.size <= MAX_KEYS) return;
  // Find a victim — the bucket with the oldest lastRefill.
  let oldestKey: string | null = null;
  let oldestTs = Number.POSITIVE_INFINITY;
  for (const [k, b] of STORE) {
    if (b.lastRefill < oldestTs) {
      oldestTs = b.lastRefill;
      oldestKey = k;
    }
  }
  if (oldestKey !== null) STORE.delete(oldestKey);
}

type ConsumeOpts = {
  /** Capacity of the bucket. Equivalent to "max requests in `windowMs`". */
  capacity: number;
  /** Window in milliseconds. The bucket refills linearly over `windowMs`. */
  windowMs: number;
};

/**
 * Consume one token from the bucket identified by `key`. If the bucket has
 * fewer than one token, returns `{ ok: false, ... }` with the time until the
 * bucket is full enough for one more request.
 *
 * The bucket refills linearly: `tokens + (now - lastRefill) * (capacity / windowMs)`.
 * So a capacity=20, windowMs=60_000 bucket lets through 20 requests in
 * 60s, then refills at 1 token / 3s.
 */
export function consume(key: string, opts: ConsumeOpts): RateLimitResult {
  const now = Date.now();
  const refillPerMs = opts.capacity / opts.windowMs;
  let bucket = STORE.get(key);
  if (!bucket) {
    bucket = { tokens: opts.capacity, lastRefill: now };
    STORE.set(key, bucket);
    evictIfFull();
  } else {
    // Linear refill.
    const elapsed = Math.max(0, now - bucket.lastRefill);
    bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefill = now;
    if (bucket.tokens >= opts.capacity) STORE.delete(key); // free idle slots
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }

  // Time until the bucket has 1 token again.
  const deficit = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(deficit / refillPerMs);
  return { ok: false, remaining: 0, retryAfterMs };
}

/** Test-only — resets the bucket store. Not exported on the production path. */
export function __resetRateLimitStore() {
  STORE.clear();
}

// ---------------------------------------------------------------------------
// HTTP-friendly extras: client IP extraction + typed rate-limit error.
// ---------------------------------------------------------------------------

/**
 * Pull the originating client IP out of a Headers / Record shape, using
 * X-Forwarded-For first (Vercel sets this on every request), then falling
 * back to X-Real-IP, then to "unknown".
 *
 * X-Forwarded-For is a comma-separated list of IPs: client, proxy1, proxy2.
 * We want the LEFTMOST entry that is not a private/RFC1918 address — that's
 * the public client. If everything is private (the request came from inside
 * the Vercel network), we fall back to the leftmost.
 *
 * Why the private-IP filter: Vercel's edge network adds its own IP to the
 * chain. Returning the Vercel IP would mean every request shares a single
 * rate-limit bucket — defeating the purpose for multi-tenant attacks.
 *
 * Returns "unknown" when no usable header exists; the caller should still
 * rate-limit on that bucket (it's the catch-all that catches scripted
 * requests without forwarded headers).
 */
export function getClientIp(headers: Headers | Record<string, string | undefined>): string {
  const xff = readHeader(headers, "x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Try left-to-right; first non-private wins.
    for (const part of parts) {
      if (!isPrivateIp(part)) return part;
    }
    // All private (or list unparseable) — return leftmost anyway, so we
    // still bucket.
    if (parts[0]) return parts[0];
  }
  const xri = readHeader(headers, "x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function readHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  // Headers are case-insensitive; Record values from request.headers are
  // lowercased by TanStack Start already, but check both.
  const v = headers[name] ?? headers[name.toLowerCase()];
  return v ?? null;
}

/**
 * Coarse private-IP check (RFC 1918 + loopback + link-local). Good enough
 * for "is this the Vercel proxy?" — we don't need full RFC compliance.
 */
function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("172.")) {
    const octet = Number.parseInt(ip.split(".")[1] ?? "", 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

/**
 * Friendly error thrown when a serverFn hits its rate limit. Carries the
 * retry hint so the UI can show "try again in N seconds" instead of a
 * generic 429 message.
 */
export class TooManyRequestsError extends Error {
  readonly code = "TOO_MANY_REQUESTS";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, what: string) {
    super(`Too many ${what}. Please wait a moment before trying again.`);
    this.name = "TooManyRequestsError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Convenience wrapper: consume a token from the bucket, and if the bucket
 * is empty, throw a TooManyRequestsError with the typed retry hint.
 *
 * Use this from serverFns instead of `consume()` + manual `if (!rl.ok)`.
 */
export function enforceRateLimit(key: string, opts: ConsumeOpts, what: string): void {
  const rl = consume(key, opts);
  if (!rl.ok) {
    throw new TooManyRequestsError(rl.retryAfterMs, what);
  }
}
