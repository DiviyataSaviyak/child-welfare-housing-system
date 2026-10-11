import { expect, test } from "@playwright/test";

/**
 * SEC-5: the headers every page carries, read from the running app. CI runs the production build,
 * so the policy has no 'unsafe-eval' there; the development server needs it for React's overlays.
 * HSTS comes only from a build with APP_ENV=production (the server's image); CI's build is "ci".
 */
test("a page carries the security headers and a fresh nonce", async ({ request }) => {
  const first = await request.get("/login");
  const second = await request.get("/login");
  const headers = first.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-powered-by"]).toBeUndefined();

  const csp = headers["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/https?:/);
  if (process.env.CI) expect(csp).not.toContain("unsafe-eval");

  // A new nonce for every page, and every script of the page carries it.
  expect(second.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
  const html = await first.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`);
});

test("a signed-out visitor is sent to sign in before any file is looked up (SEC-7)", async ({ request }) => {
  const response = await request.get("/files/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toMatch(/\/login\?next=%2Ffiles%2F/);
});
