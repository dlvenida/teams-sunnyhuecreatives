import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5190",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5190",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
})
