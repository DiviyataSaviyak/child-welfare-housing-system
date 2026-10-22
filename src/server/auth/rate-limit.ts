import type { PrismaClient } from "@/generated/prisma/client";
import { keyedHash } from "./keyed-hash";

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

/**
 * A fixed-window counter per client address, kept in the database (`rate_limit`): the servers run
 * two app containers, and each counting in its own memory would let twice as many attempts through.
 * A window starts with its first attempt. Only an HMAC of the address is stored.
 */
export function createRateLimiter({ name, limit, windowMs }: { name: string; limit: number; windowMs: number }) {
  const prefix = `${name}:`;

  const countAttempt = (db: PrismaClient, key: string, now: Date) =>
    db.rateLimit.upsert({
      where: { key },
      create: { key, windowStart: now, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });

  return {
    /** Counts one attempt for this key and says whether it is allowed. */
    async allow(db: PrismaClient, key: string, now: Date = new Date()): Promise<boolean> {
      // A window that has ended counts for nothing, so its row goes and the next attempt starts anew.
      await db.rateLimit.deleteMany({
        where: { key: { startsWith: prefix }, windowStart: { lte: new Date(now.getTime() - windowMs) } },
      });
      const id = prefix + keyedHash(key);
      // Two first attempts at the same moment can both try to add the row; the second then counts on it.
      const row = await countAttempt(db, id, now).catch((error: unknown) => {
        if (isUniqueViolation(error)) return countAttempt(db, id, now);
        throw error;
      });
      return row.count <= limit;
    },
  };
}

/** SEC-4: at most 10 sign-in attempts per minute from one IP address. */
export const signInLimiter = createRateLimiter({ name: "sign-in", limit: 10, windowMs: 60_000 });

/** SEC-4: at most 5 email codes for a forgotten password asked for per 15 minutes from one IP address (AUTH-7). */
export const resetCodeLimiter = createRateLimiter({ name: "reset-code", limit: 5, windowMs: 15 * 60_000 });

/**
 * The client's IP address. On the server Caddy overwrites X-Forwarded-For with the real address
 * (the Infrastructure repository's Caddyfile), so the first entry is trusted; without it every request counts as "unknown".
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
