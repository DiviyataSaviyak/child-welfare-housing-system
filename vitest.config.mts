import { defineConfig } from "vitest/config";

// Unit tests: no database needed. Database tests live in *.db.test.ts and run with vitest.db.config.mts.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/security/**/*.test.ts"],
    exclude: ["**/*.db.test.ts", "node_modules/**"],
  },
});
