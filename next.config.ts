import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { staticSecurityHeaders } from "./src/server/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Standalone output is what the production Docker image runs (OPS-2).
  output: "standalone",
  // The tracer copies the project's files beside the server; tests, scripts and notes don't belong there.
  outputFileTracingExcludes: { "*": ["./tests/**", "./scripts/**", "./docker/**", "./*.md"] },
  poweredByHeader: false,
  // ExcelJS is large and runs only on the server. Node loads it from node_modules instead of the
  // bundler compiling it, which in development held up every other page while it compiled.
  serverExternalPackages: ["exceljs"],
  experimental: {
    // Each upload is its own request: a document of at most 10 MB (CASE-2) or a photo of at most 15 MB
    // (STG-1), plus room for the form's own bytes. The proxy buffers request bodies too, and above its
    // limit it would silently cut them short.
    serverActions: { bodySizeLimit: "16mb" },
    proxyClientMaxBodySize: "16mb",
  },
  // UI-10 (change 0006): Head Office's pages moved from /ho to /ministry; old links and bookmarks still
  // arrive. Temporary (307), so browsers don't keep it for good while the change moves pages around.
  async redirects() {
    return [
      // Version 1's check screen is gone (change 0006); its old addresses lead to the allocation letters.
      { source: "/ho/check", destination: "/ministry/release", permanent: false },
      { source: "/ministry/check", destination: "/ministry/release", permanent: false },
      { source: "/ho/:path*", destination: "/ministry/:path*", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders({ production: process.env.APP_ENV === "production" }) },
    ];
  },
};

export default withNextIntl(nextConfig);
