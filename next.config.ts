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
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders({ production: process.env.APP_ENV === "production" }) },
    ];
  },
};

export default withNextIntl(nextConfig);
