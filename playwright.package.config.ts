import { defineConfig, devices } from "@playwright/test";

// The installed package's consumer app, started by scripts/package-e2e.ts.
export default defineConfig({
  testDir: "e2e-package/specs",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.PACKAGE_BASE ?? "http://localhost:4500", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
