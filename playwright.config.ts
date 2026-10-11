import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests",
  // The end-to-end tests, and the security checks that need the running app (task 9.9).
  testMatch: ["e2e/**/*.spec.ts", "security/**/*.spec.ts"],
  // Puts the sample accounts back to their starting state before every run.
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // The dev server compiles each page on first use, which can be slow while tests run in parallel.
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    locale: "si-LK",
    timezoneId: "Asia/Colombo",
  },
  projects: [
    {
      name: "chromium",
      // Screens are designed for office desktops first (UI-2).
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // CI tests the standalone production build (run `npm run build` first); locally the dev server is used.
    command: process.env.CI ? "npm run start:standalone" : `npm run dev -- -p ${PORT}`,
    env: { PORT: String(PORT), HOSTNAME: "127.0.0.1", BETTER_AUTH_URL: BASE_URL },
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
