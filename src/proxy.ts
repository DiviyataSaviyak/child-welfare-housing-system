import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./server/security-headers";

/** Areas that need a signed-in user. */
const PROTECTED = ["/ds", "/ho", "/oversight", "/admin", "/change-password", "/files"];

/**
 * Two jobs only (ARC-3):
 * 1. A quick cookie check that sends signed-out visitors to the sign-in page. The real check of
 *    the session, role and office happens on the server for every page and action (src/server/context.ts).
 * 2. A fresh nonce for the Content Security Policy on every page (SEC-5).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED.some((area) => pathname === area || pathname.startsWith(`${area}/`));
  if (isProtected && !getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/change-password") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // An uploaded file is not a page, and the page policy (object-src 'none') could stop the browser's PDF viewer.
  if (pathname.startsWith("/files/")) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not static files, and not link prefetches, which need neither check.
      source: "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
