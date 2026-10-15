import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin, username } from "better-auth/plugins";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";
import { SESSION_MAX_AGE_SECONDS } from "@/server/auth/session-rules";
import { db } from "@/server/db";

/**
 * Better Auth is called only from our own server code: Server Actions and the data-access layer.
 * Its HTTP endpoints are deliberately not mounted. Version 1 has no public API (ARC-1), and every
 * sign-in must pass our lockout and rate limit (AUTH-2, SEC-4), which a direct call to
 * Better Auth's endpoint would skip.
 */
export const auth = betterAuth({
  appName: "Diviyata Saviyak",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Only the admin creates accounts (ADM-2).
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
  },
  session: {
    // AUTH-4: a fixed 12-hour limit. The 30-minute idle limit is checked in src/server/context.ts.
    expiresIn: SESSION_MAX_AGE_SECONDS,
    disableSessionRefresh: true,
  },
  plugins: [
    username({ minUsernameLength: 3, maxUsernameLength: 32 }),
    admin({ adminRoles: ["ADMIN"] }),
    // Lets Server Actions set the session cookie. Must stay last.
    nextCookies(),
  ],
});
