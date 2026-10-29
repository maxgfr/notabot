import { defineConfig, devices } from "@playwright/test";

// The deployed site, as visitors get it (see .github/workflows/live.yml).
export default defineConfig({
  testDir: "e2e-live",
  timeout: 60_000,
  retries: 2,
  use: {
    baseURL: process.env.LIVE_URL ?? "https://maxgfr.github.io",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
