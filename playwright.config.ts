import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  workers: 2,
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 15000 },
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
  ],
});
