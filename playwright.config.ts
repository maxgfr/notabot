import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:4318", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun scripts/serve.ts",
    env: { PORT: "4318" },
    url: "http://localhost:4318/notabot/",
    reuseExistingServer: !process.env.CI,
  },
});
