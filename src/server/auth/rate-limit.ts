/**
 * A fixed-window counter kept in memory. Version 1 runs as one server process (OPS-2),
 * so memory is enough; a restart simply clears the counts.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    /** Counts one attempt for this key and says whether it is allowed. */
    allow(key: string, now: number = Date.now()): boolean {
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}

/** SEC-4: at most 10 sign-in attempts per minute from one IP address. */
export const signInLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** SEC-4: at most 5 requests for a new password per 15 minutes from one IP address (AUTH-7). */
export const newPasswordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

/**
 * The client's IP address. On the server Caddy overwrites X-Forwarded-For with the real address
 * (deploy/server/caddy/Caddyfile), so the first entry is trusted; without it every request counts as "unknown".
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
