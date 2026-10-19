import { createHmac } from "node:crypto";

/**
 * An HMAC-SHA256 keyed by BETTER_AUTH_SECRET, for a value the database must recognise but never hold:
 * a reset code (AUTH-7), a username with no account (AUTH-2) or a client's address (SEC-4).
 */
export function keyedHash(value: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(value).digest("hex");
}
