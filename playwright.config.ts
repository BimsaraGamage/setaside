import { defineConfig, devices } from "@playwright/test";

const port = 5173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // The service worker (item 23) only in the journeys about it (offline.spec.ts): elsewhere it would keep
  // files between steps that the journeys don't expect.
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry", serviceWorkers: "block" },
  projects: [
    { name: "chromium", use: { ...devices["Pixel 7"] } },
    { name: "webkit", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: `npm run db:migrate:local && npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
